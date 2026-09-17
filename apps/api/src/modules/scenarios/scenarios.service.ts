import { Injectable } from '@nestjs/common';

import {
  contextSchemaSchema,
  methodItemSchema,
  methodPassportSchema,
  type PublicScenario,
} from '@context/contracts';
import type { TenantTransaction } from '@context/database';
import {
  SCENARIO_LIMITS,
  SCENARIO_PURPOSES,
  isContentAllowedInMode,
  type ApplicabilityMode,
  type OrganizationMode,
  type ScenarioCode,
} from '@context/domain';
import { z } from 'zod';

import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { OrganizationsService } from '../organizations/organizations.service';

const itemsSchema = z.array(methodItemSchema);

/**
 * Каталог сценариев для руководителя.
 *
 * Возвращается только публичная проекция: тексты вопросов не входят,
 * ключи подсчёта и нормы — тем более. Их нет в DTO вообще, а не спрятаны в UI.
 */
@Injectable()
export class ScenariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly organizations: OrganizationsService,
  ) {}

  async list(organizationId: string): Promise<PublicScenario[]> {
    const readiness = await this.organizations.readiness(organizationId);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const versions = await tx.scenario_versions.findMany({
        where: { status: 'published' },
        select: scenarioVersionSelect,
        orderBy: { created_at: 'asc' },
      });

      /*
       * Один сценарий может накопить несколько опубликованных версий (старые
       * остаются читаемыми для уже созданных назначений). Для нового назначения
       * руководителю нужна только последняя — иначе в шаге выбора появляются
       * визуально неотличимые дубликаты одной и той же карточки (ТЗ M05).
       */
      const latestByCode = new Map<string, (typeof versions)[number]>();
      for (const version of versions) {
        latestByCode.set(version.scenario.stable_code, version);
      }

      return Array.from(latestByCode.values()).map((version) =>
        toPublicScenario(
          version,
          readiness.mode,
          readiness.canRunRealAssessments,
          readiness.blockedReasons,
        ),
      );
    });
  }

  async get(organizationId: string, scenarioVersionId: string): Promise<PublicScenario> {
    const readiness = await this.organizations.readiness(organizationId);

    return this.prisma.tenant({ organizationId }, async (tx) => {
      const version = await tx.scenario_versions.findFirst({
        where: { id: scenarioVersionId, status: 'published' },
        select: scenarioVersionSelect,
      });

      if (!version) {
        throw AppError.notFound(`Версия сценария ${scenarioVersionId} недоступна`);
      }

      return toPublicScenario(
        version,
        readiness.mode,
        readiness.canRunRealAssessments,
        readiness.blockedReasons,
      );
    });
  }

  /** Версия сценария вместе с закреплёнными методиками. Используется при назначении. */
  async loadForAssignment(
    tx: TenantTransaction,
    scenarioVersionId: string,
  ): Promise<{
    id: string;
    code: ScenarioCode;
    applicabilityMode: ApplicabilityMode;
    contextSchema: ReturnType<typeof contextSchemaSchema.parse>;
    methods: Array<{ methodVersionId: string; orderIndex: number; required: boolean }>;
  }> {
    const version = await tx.scenario_versions.findFirst({
      where: { id: scenarioVersionId, status: 'published' },
      select: scenarioVersionSelect,
    });

    if (!version) {
      throw AppError.businessRule('Выбранная версия сценария недоступна для назначения');
    }

    return {
      id: version.id,
      code: version.scenario.stable_code as ScenarioCode,
      applicabilityMode: version.applicability_mode as ApplicabilityMode,
      contextSchema: contextSchemaSchema.parse(version.context_schema_json),
      methods: version.scenario_methods.map((link) => ({
        methodVersionId: link.method_version_id,
        orderIndex: link.order_index,
        required: link.required,
      })),
    };
  }
}

const scenarioVersionSelect = {
  id: true,
  semantic_version: true,
  applicability_mode: true,
  context_schema_json: true,
  participant_visibility: true,
  scenario: { select: { stable_code: true, title: true } },
  scenario_methods: {
    select: {
      order_index: true,
      required: true,
      method_version_id: true,
      method_versions: {
        select: {
          id: true,
          passport_json: true,
          items_json: true,
          applicability_mode: true,
          status: true,
          method: { select: { stable_code: true } },
        },
      },
    },
    orderBy: { order_index: 'asc' as const },
  },
} as const;

type ScenarioVersionRow = {
  id: string;
  semantic_version: string;
  applicability_mode: string;
  context_schema_json: unknown;
  participant_visibility: string;
  scenario: { stable_code: string; title: string };
  scenario_methods: Array<{
    order_index: number;
    required: boolean;
    method_version_id: string;
    method_versions: {
      id: string;
      passport_json: unknown;
      items_json: unknown;
      applicability_mode: string;
      status: string;
      method: { stable_code: string };
    };
  }>;
};

function toPublicScenario(
  version: ScenarioVersionRow,
  organizationMode: OrganizationMode,
  readinessAllows: boolean,
  readinessReasons: readonly string[],
): PublicScenario {
  const code = version.scenario.stable_code as ScenarioCode;
  const contentMode = version.applicability_mode as ApplicabilityMode;

  const blockedReasons: string[] = [];

  // Синтетическое содержимое нельзя назначать в реальном режиме организации.
  if (!isContentAllowedInMode(contentMode, organizationMode)) {
    blockedReasons.push(
      `Содержимое сценария помечено уровнем «${contentMode}» и не допускается в режиме организации «${organizationMode}».`,
    );
  }

  if (organizationMode !== 'demo' && !readinessAllows) {
    blockedReasons.push(...readinessReasons);
  }

  for (const link of version.scenario_methods) {
    if (link.method_versions.status !== 'published') {
      blockedReasons.push('Одна из методик сценария приостановлена или снята с публикации.');
    }
  }

  return {
    scenarioVersionId: version.id,
    code,
    title: version.scenario.title,
    purpose: SCENARIO_PURPOSES[code],
    limits: SCENARIO_LIMITS[code],
    applicabilityMode: contentMode,
    semanticVersion: version.semantic_version,
    contextSchema: contextSchemaSchema.parse(version.context_schema_json),
    methods: version.scenario_methods.map((link) => {
      const passport = methodPassportSchema.parse(link.method_versions.passport_json);
      const items = itemsSchema.parse(link.method_versions.items_json);
      return {
        methodVersionId: link.method_versions.id,
        code: link.method_versions.method.stable_code,
        title: passport.title,
        itemCount: items.length,
        estimatedMinutes: passport.estimatedMinutes,
        required: link.required,
        orderIndex: link.order_index,
        limitations: passport.limitations,
      };
    }),
    participantVisibility:
      version.participant_visibility as PublicScenario['participantVisibility'],
    availability: {
      canAssign: blockedReasons.length === 0,
      blockedReasons,
    },
  };
}
