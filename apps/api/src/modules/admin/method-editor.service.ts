import { Injectable } from '@nestjs/common';

import {
  hasBlockers,
  methodDraftContentSchema,
  validateMethodStructure,
  type AdminMethodVersion,
  type CreateMethodInput,
  type CreateMethodVersionInput,
  type MethodImportPreview,
  type UpdateMethodVersionInput,
} from '@context/contracts';
import { toJson } from '@context/database';
import { contentHash } from '@context/scoring';
import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { AdminContentService } from './admin-content.service';

/** Пустой паспорт новой методики: поля обязательны и AI их не заполняет. */
const EMPTY_PASSPORT = {
  title: '',
  purpose: '',
  targetPopulation: '',
  language: 'ru',
  limitations: [] as string[],
  sourceStatement: '',
  rightsStatement: '',
  estimatedMinutes: null,
  participantIntro: '',
};

/**
 * Редактирование содержимого методики.
 *
 * Правится только черновик. Опубликованная версия неизменяема — это не
 * ограничение интерфейса, а инвариант: назначение обязано считаться по тем
 * правилам, по которым создавалось (ТЗ 01.5, 07.4).
 */
@Injectable()
export class MethodEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: AdminContentService,
    private readonly audit: AuditService,
  ) {}

  async createMethod(input: CreateMethodInput, actorId: string): Promise<AdminMethodVersion> {
    const versionId = await this.prisma.platformOps(async (tx) => {
      const existing = await tx.methods.findUnique({
        where: { stable_code: input.code },
        select: { id: true },
      });
      if (existing) {
        throw AppError.validation(
          [{ field: 'code', message: 'Методика с таким кодом уже существует' }],
          'Код методики должен быть уникальным',
        );
      }

      const method = await tx.methods.create({
        data: { stable_code: input.code, title: input.title },
        select: { id: true },
      });

      const version = await tx.method_versions.create({
        data: {
          method_id: method.id,
          semantic_version: input.semanticVersion || '1.0.0',
          status: 'draft',
          // Новая методика начинает на уровне demo: заявление о применимости
          // требует отдельного основания, а не галочки при создании.
          applicability_mode: 'demo',
          passport_json: toJson({ ...EMPTY_PASSPORT, title: input.title }),
          items_json: toJson([]),
          scoring_config_json: toJson({ missingPolicy: 'reject', scales: [] }),
          fixtures_json: toJson([]),
          validation_metadata: toJson({
            status: 'not_validated',
            note: 'Применимость не проверялась.',
          }),
          license_metadata: toJson({}),
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'method.created',
        outcome: 'success',
        resourceType: 'method_version',
        resourceId: version.id,
        metadata: { code: input.code, actorId },
      });

      return version.id;
    });

    return this.content.getMethodVersion(versionId);
  }

  /** Новая версия существующей методики, опционально копией из другой версии. */
  async createVersion(
    methodId: string,
    input: CreateMethodVersionInput,
    actorId: string,
  ): Promise<AdminMethodVersion> {
    const versionId = await this.prisma.platformOps(async (tx) => {
      const method = await tx.methods.findUnique({
        where: { id: methodId },
        select: { id: true, title: true },
      });
      if (!method) {
        throw AppError.notFound(`Методика ${methodId} не найдена`);
      }

      const duplicate = await tx.method_versions.findFirst({
        where: { method_id: methodId, semantic_version: input.semanticVersion },
        select: { id: true },
      });
      if (duplicate) {
        throw AppError.validation(
          [{ field: 'semanticVersion', message: 'Такая версия уже существует' }],
          'Номер версии должен быть уникальным внутри методики',
        );
      }

      const source = input.copyFromVersionId
        ? await tx.method_versions.findFirst({
            where: { id: input.copyFromVersionId, method_id: methodId },
            select: {
              passport_json: true,
              items_json: true,
              scoring_config_json: true,
              fixtures_json: true,
              applicability_mode: true,
              license_metadata: true,
            },
          })
        : null;

      if (input.copyFromVersionId && !source) {
        throw AppError.notFound('Исходная версия не найдена в этой методике');
      }

      const passport = source?.passport_json ?? toJson({ ...EMPTY_PASSPORT, title: method.title });
      const items = source?.items_json ?? toJson([]);
      const scoring =
        source?.scoring_config_json ?? toJson({ missingPolicy: 'reject', scales: [] });

      const version = await tx.method_versions.create({
        data: {
          method_id: methodId,
          semantic_version: input.semanticVersion,
          status: 'draft',
          applicability_mode: source?.applicability_mode ?? 'demo',
          passport_json: passport,
          items_json: items,
          scoring_config_json: scoring,
          fixtures_json: source?.fixtures_json ?? toJson([]),
          // Хэш копии считается сразу: неизменяемость опубликованной версии
          // доказывается хэшем, без него публикация копии невозможна.
          content_hash: source ? contentHash({ passport, items, scoring }) : null,
          license_metadata: source?.license_metadata ?? toJson({}),
          validation_metadata: toJson({
            status: 'not_validated',
            note: 'Применимость новой версии проверяется отдельно.',
          }),
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'method_version.created',
        outcome: 'success',
        resourceType: 'method_version',
        resourceId: version.id,
        metadata: {
          semanticVersion: input.semanticVersion,
          copiedFrom: input.copyFromVersionId ?? null,
          actorId,
        },
      });

      return version.id;
    });

    return this.content.getMethodVersion(versionId);
  }

  /**
   * Сохранение черновика.
   *
   * Структура проверяется до записи: ссылка шкалы на несуществующий вопрос,
   * пропущенные баллы вариантов и повторяющиеся идентификаторы не сохраняются.
   * Хэш содержимого служит оптимистичной блокировкой.
   */
  async updateDraft(
    versionId: string,
    input: UpdateMethodVersionInput,
    actorId: string,
  ): Promise<AdminMethodVersion> {
    const issues = validateMethodStructure(input.items, input.scoring);
    if (hasBlockers(issues)) {
      throw AppError.validation(
        issues
          .filter((issue) => issue.severity === 'blocker')
          .map((issue) => ({ field: issue.target, message: issue.message })),
        'Содержимое нельзя сохранить: есть противоречия в вопросах или ключах подсчёта',
      );
    }

    await this.prisma.platformOps(async (tx) => {
      const version = await tx.method_versions.findUnique({
        where: { id: versionId },
        select: { id: true, status: true, content_hash: true },
      });

      if (!version) {
        throw AppError.notFound(`Версия методики ${versionId} не найдена`);
      }
      if (version.status !== 'draft') {
        throw AppError.conflict(
          'Эта версия уже не черновик. Создайте новую версию, чтобы внести изменения.',
        );
      }
      if (version.content_hash !== input.expectedContentHash) {
        throw AppError.revisionConflict(
          'Версия была изменена в другом окне. Обновите страницу, чтобы не потерять чужую правку.',
        );
      }

      const nextHash = contentHash({
        passport: input.passport,
        items: input.items,
        scoring: input.scoring,
      });

      await tx.method_versions.update({
        where: { id: versionId },
        data: {
          applicability_mode: input.applicabilityMode,
          passport_json: toJson(input.passport),
          items_json: toJson(input.items),
          scoring_config_json: toJson(input.scoring),
          fixtures_json: toJson(input.fixtures),
          missing_policy: input.scoring.missingPolicy,
          content_hash: nextHash,
        },
      });

      await this.audit.recordIn(tx, {
        action: 'method_version.updated',
        outcome: 'success',
        resourceType: 'method_version',
        resourceId: versionId,
        metadata: {
          itemCount: input.items.length,
          scaleCount: input.scoring.scales.length,
          warnings: issues.length,
          actorId,
        },
      });
    });

    return this.content.getMethodVersion(versionId);
  }

  /**
   * Разбор импортируемого JSON без записи.
   *
   * Показывает, что будет записано и какие есть проблемы. Ничего не меняет:
   * решение принимает человек, увидев список ошибок (ТЗ A05).
   */
  previewImport(raw: unknown): MethodImportPreview {
    const parsed = methodDraftContentSchema.safeParse(raw);

    if (!parsed.success) {
      return {
        accepted: false,
        summary: null,
        schemaErrors: parsed.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.') || '(корень)',
          message: issue.message,
        })),
        issues: [],
      };
    }

    const content = parsed.data;
    const issues = validateMethodStructure(content.items, content.scoring);

    return {
      accepted: !hasBlockers(issues),
      summary: {
        title: content.passport.title,
        itemCount: content.items.length,
        scaleCount: content.scoring.scales.length,
        fixtureCount: content.fixtures.length,
      },
      schemaErrors: [],
      issues: issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        message: issue.message,
        target: issue.target,
      })),
    };
  }

  /** Структурные замечания для открытой версии: показываются в редакторе. */
  async issuesFor(versionId: string): Promise<MethodImportPreview['issues']> {
    const version = await this.content.getMethodVersion(versionId);
    return validateMethodStructure(version.items, version.scoring).map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
      target: issue.target,
    }));
  }
}
