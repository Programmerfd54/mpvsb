import { Injectable } from '@nestjs/common';

import {
  ACCESS_GRANT_MAX_HOURS,
  accessGrantScopeSchema,
  type AccessGrant,
  type AdminAssignmentSummary,
  type AccessGrantPurpose,
  type AccessGrantState,
  type ApproveAccessGrantInput,
  type CreateAccessGrantInput,
  type ExtendAccessGrantInput,
  type GrantedCase,
  type RejectAccessGrantInput,
  type ReportDetail,
  type RevokeAccessGrantInput,
} from '@context/contracts';
import { resolveUserMemberships, toJson, type TenantTransaction } from '@context/database';
import {
  NOTIFICATION_TITLES,
  caseCodeFor,
  hasPermission,
  notificationEventKey,
  type OrgPermission,
} from '@context/domain';

import { AuditService } from '../../platform/audit/audit.service';
import { PrismaService } from '../../platform/database/prisma.service';
import { AppError } from '../../platform/errors/app-error';
import { ReportsService } from '../reports/reports.service';
import { GRANT_PERMISSION, isGrantLiveFor } from './grant-guard';

/**
 * Временный доступ администратора платформы к данным организации.
 *
 * По умолчанию администратор видит эксплуатационные метаданные и не видит
 * заключений. Доступ выдаёт владелец организации: на названную цель, к
 * перечисленным назначениям и на ограниченный срок. Сам запрашивающий своё
 * обращение не одобряет — это проверяет и сервер, и ограничение БД
 * (ТЗ 10.4, A03, M13).
 *
 * Истечение не хранится состоянием и не ждёт фонового задания: срок
 * проверяется при каждом обращении, а чтение данных перепроверяет грант в
 * своей транзакции по часам базы.
 */

const GRANT_SELECT = {
  id: true,
  organization_id: true,
  grantee_user_id: true,
  purpose: true,
  state: true,
  reason: true,
  resource_scope: true,
  requested_at: true,
  requested_hours: true,
  approved_at: true,
  expires_at: true,
  revoked_at: true,
  decision_note: true,
  extends_grant_id: true,
  organizations: { select: { code: true, name: true } },
  requester: { select: { id: true, display_name: true } },
  approver: { select: { id: true, display_name: true } },
} as const;

interface GrantRow {
  id: string;
  organization_id: string;
  grantee_user_id: string;
  purpose: string;
  state: string;
  reason: string;
  resource_scope: unknown;
  requested_at: Date;
  requested_hours: number | null;
  approved_at: Date | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  decision_note: string | null;
  extends_grant_id: string | null;
  organizations: { code: string; name: string };
  requester: { id: string; display_name: string | null };
  approver: { id: string; display_name: string | null } | null;
}

/** Поля, нужные для решения по обращению. */
const DECISION_SELECT = {
  id: true,
  state: true,
  purpose: true,
  reason: true,
  requested_by: true,
  grantee_user_id: true,
  requested_hours: true,
  expires_at: true,
  revoked_at: true,
  resource_scope: true,
  permissions: true,
  extends_grant_id: true,
} as const;

interface DecisionRow {
  id: string;
  state: string;
  purpose: string;
  reason: string;
  requested_by: string;
  grantee_user_id: string;
  requested_hours: number | null;
  expires_at: Date | null;
  revoked_at: Date | null;
  resource_scope: unknown;
  permissions: string[];
  extends_grant_id: string | null;
}

/**
 * Грант и его получатель.
 *
 * Получатель (`grantee_user_id`) — та же колонка, по которой грант проверяется
 * в транзакции чтения: предварительная и транзакционная проверки должны
 * отвечать за одного человека. В контракт он не выносится, наружу уходит
 * только карточка обращения.
 */
interface GranteeGrant {
  readonly grant: AccessGrant;
  readonly granteeUserId: string;
}

/** Почему привилегированная попытка не прошла. Без имён и текста причины (ТЗ 10.9). */
type DeniedReason =
  | 'missing_permission'
  | 'self_approval'
  | 'no_membership'
  | 'not_owner'
  /** Грант существует и принадлежит обратившемуся, но организация в пути другая. */
  | 'org_mismatch'
  | 'unknown_grant';

/** Кто вправе решать по обращениям: владелец организации (ТЗ M13). */
const DECISION_PERMISSION: OrgPermission = 'org.manage';

/** Почему доступа нет и что делать дальше — по состоянию обращения. */
const DENIED_MESSAGES: Readonly<Record<AccessGrantState, string>> = {
  requested: 'Доступ ещё не выдан: обращение ждёт решения владельца организации.',
  approved: 'Срок доступа истёк. Запросите продление или оформите новое обращение.',
  expired: 'Срок доступа истёк. Запросите продление или оформите новое обращение.',
  rejected:
    'Обращение отклонено владельцем организации. Оформите новое обращение с уточнённой причиной.',
  // Отозвать может и владелец, и сам получатель: текст не утверждает, кто именно.
  revoked: 'Доступ по этому обращению отозван. Оформите новое обращение, если он всё ещё нужен.',
};

@Injectable()
export class AccessGrantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  // ——— Сторона администратора ———

  /**
   * Запрос доступа администратором.
   *
   * Объём перечисляется назначениями: выдать доступ «ко всей организации»
   * нельзя. Существование назначений проверяется узким резолвером, который
   * возвращает только признаки состояния и никакого содержания.
   */
  async request(
    organizationId: string,
    actorId: string,
    input: CreateAccessGrantInput,
  ): Promise<AccessGrant> {
    const assignmentIds = [...new Set(input.assignmentIds)];

    // Организация и объём проверяются в одной транзакции и на одном снимке:
    // поштучная проверка давала бы до 20 round-trip и расходящийся перечень.
    // Резолвер 0016 возвращает только идентификаторы, без содержания.
    const known = await this.prisma.platformOps(async (tx) => {
      const organization = await tx.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });

      if (!organization) {
        throw AppError.notFound(`Организация ${organizationId} не найдена`);
      }

      return resolveOrgAssignmentIds(tx, organizationId, assignmentIds);
    });
    const unknown = assignmentIds.filter((assignmentId) => !known.has(assignmentId));

    if (unknown.length > 0) {
      throw AppError.validation(
        [
          {
            field: 'assignmentIds',
            message: `Не найдены в этой организации: ${unknown.join(', ')}. Проверьте коды назначений.`,
          },
        ],
        'Объём доступа указан неверно',
      );
    }

    /*
     * Транзакция идёт с контекстом организации: уведомление владельцам живёт
     * в `core.notifications` со строгой политикой RLS, и без организации в
     * контексте вставка была бы отклонена. Эксплуатационный режим при этом
     * сохраняется — он нужен для самих `core.access_grants`.
     *
     * Контекст организации в этой транзакции открывает строгие tenant-таблицы,
     * поэтому в ней делается ровно необходимое: запись обращения, журнал,
     * поиск адресатов среди участников и вставка уведомления. Заключения и
     * ответы здесь не читаются — их по-прежнему открывает только действующий
     * грант в собственной транзакции чтения.
     */
    const grantId = await this.prisma.tenant({ organizationId, platformOps: true }, async (tx) => {
      const created = await tx.access_grants.create({
        data: {
          organization_id: organizationId,
          grantee_user_id: actorId,
          requested_by: actorId,
          purpose: input.purpose,
          reason: input.reason,
          resource_scope: toJson({ assignmentIds }),
          permissions: [GRANT_PERMISSION],
          requested_hours: input.requestedHours,
          state: 'requested',
        },
        select: { id: true },
      });

      // Текст причины в журнал не пишется: там только технические признаки.
      await this.audit.recordIn(tx, {
        action: 'access_grant.requested',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: created.id,
        purpose: input.purpose,
        metadata: {
          actorId,
          cases: assignmentIds.length,
          requestedHours: input.requestedHours,
        },
      });

      await this.notifyOwners(tx, organizationId, created.id, actorId);

      return created.id;
    });

    return this.byId(grantId);
  }

  /**
   * Запрос продления.
   *
   * Продление — новая запись со ссылкой на прежний грант: срок прежнего не
   * меняется, объём и цель не расширяются, решение снова принимает владелец.
   */
  async requestExtension(
    organizationId: string,
    grantId: string,
    actorId: string,
    input: ExtendAccessGrantInput,
  ): Promise<AccessGrant> {
    // Проверка получателя идёт до транзакции: запись об отказе не должна
    // откатиться вместе с ней (ТЗ 10.9).
    const found = await this.findById(grantId);
    if (
      !found ||
      found.grant.organizationId !== organizationId ||
      found.granteeUserId !== actorId
    ) {
      // Причина в журнале должна отвечать на «что именно произошло»: обращение
      // получателя не к своей организации — не то же самое, что попытка
      // поехать на чужом гранте.
      const reason: DeniedReason = !found
        ? 'unknown_grant'
        : found.granteeUserId === actorId
          ? 'org_mismatch'
          : 'not_owner';

      await this.recordDenied(
        'access_grant.extension_denied',
        found?.grant.organizationId ?? organizationId,
        grantId,
        actorId,
        reason,
        // Организация из пути: расследовать попытку по одной лишь организации
        // гранта нечем. UUID — не персональные сведения (ТЗ 10.9).
        { requestedOrganizationId: organizationId },
      );
      // Чужое обращение не показываем как существующее.
      throw AppError.notFound(`Обращение за доступом ${grantId} не найдено`);
    }

    // Контекст организации нужен по той же причине, что и в `request`:
    // продление — такое же обращение, и владелец узнаёт о нём уведомлением.
    const nextId = await this.prisma.tenant({ organizationId, platformOps: true }, async (tx) => {
      const grant = await this.loadForDecision(tx, organizationId, grantId);

      // Жив ли продлеваемый доступ — по часам базы, а не процесса API.
      const live = await isGrantLiveFor(tx, {
        organizationId,
        grantId,
        userId: grant.grantee_user_id,
      });
      if (!live) {
        throw AppError.conflict(
          'Продлить можно только действующий доступ. Если срок истёк или доступ отозван, оформите новое обращение.',
        );
      }

      const pending = await tx.access_grants.count({
        where: { organization_id: organizationId, extends_grant_id: grantId, state: 'requested' },
      });
      if (pending > 0) {
        throw AppError.conflict(
          'Запрос продления этого доступа уже ожидает решения владельца организации.',
        );
      }

      const created = await tx.access_grants.create({
        data: {
          organization_id: organizationId,
          grantee_user_id: grant.grantee_user_id,
          requested_by: actorId,
          purpose: grant.purpose,
          reason: input.reason,
          resource_scope: toJson(grant.resource_scope),
          permissions: grant.permissions,
          requested_hours: input.requestedHours,
          state: 'requested',
          extends_grant_id: grantId,
        },
        select: { id: true },
      });

      await this.audit.recordIn(tx, {
        action: 'access_grant.extension_requested',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: created.id,
        purpose: grant.purpose,
        metadata: { actorId, extendsGrantId: grantId, requestedHours: input.requestedHours },
      });

      await this.notifyOwners(tx, organizationId, created.id, actorId);

      return created.id;
    });

    return this.byId(nextId);
  }

  /**
   * Уведомление владельцев организации о поступившем обращении (ТЗ M13, R-16).
   *
   * Без него владелец узнаёт о запросе доступа к данным о своих сотрудниках
   * только если сам зайдёт в настройки: обращение оформляет администратор
   * платформы, и инициатива целиком на его стороне. Уведомление сообщает
   * только факт — ни цели, ни причины, ни объёма в нём нет: свободный текст
   * обращения выдаётся на странице доступов, где право `org.manage`
   * проверяется заново.
   *
   * Адресаты — действующие участники с правом решать по обращениям; сам
   * обратившийся исключён, даже если он состоит в организации владельцем
   * (решение по собственному обращению запрещают и сервер, и ограничение БД).
   */
  private async notifyOwners(
    tx: TenantTransaction,
    organizationId: string,
    grantId: string,
    requesterUserId: string,
  ): Promise<void> {
    const owners = await tx.memberships.findMany({
      where: {
        organization_id: organizationId,
        status: 'active',
        permissions: { has: DECISION_PERMISSION },
        user_id: { not: requesterUserId },
      },
      select: { user_id: true },
    });

    if (owners.length === 0) {
      return;
    }

    const eventKey = notificationEventKey('access_grant_requested', grantId);

    await tx.notifications.createMany({
      data: owners.map((owner) => ({
        organization_id: organizationId,
        recipient_user_id: owner.user_id,
        type: 'access_grant_requested',
        resource_type: 'access_grant',
        resource_id: grantId,
        title: NOTIFICATION_TITLES.access_grant_requested,
        event_key: eventKey,
      })),
      // Дедупликация по «событие + адресат»: продление — отдельное обращение
      // со своим идентификатором, поэтому о нём владелец узнаёт заново.
      skipDuplicates: true,
    });
  }

  /**
   * Собственные обращения администратора; с организацией — только по ней.
   *
   * Список страничный: молча обрезанный журнал неотличим от пустого.
   */
  async listForGrantee(
    userId: string,
    query: { readonly page: number; readonly pageSize: number; readonly organizationId?: string },
  ): Promise<{ items: AccessGrant[]; total: number }> {
    return this.prisma.platformOps(async (tx) => {
      const where = {
        grantee_user_id: userId,
        ...(query.organizationId ? { organization_id: query.organizationId } : {}),
      };

      const [rows, total] = await Promise.all([
        tx.access_grants.findMany({
          where,
          orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: GRANT_SELECT,
        }),
        tx.access_grants.count({ where }),
      ]);

      return { items: rows.map((row) => toGrant(row)), total };
    });
  }

  /**
   * Действующий грант этого пользователя.
   *
   * Истечение и отзыв закрывают доступ сразу: проверка идёт по сроку, а не по
   * сохранённому состоянию. Отказ записывается в журнал.
   */
  async requireActive(grantId: string, userId: string): Promise<GranteeGrant> {
    const found = await this.findById(grantId);

    if (!found || found.granteeUserId !== userId) {
      // Попытка поехать на чужом гранте — привилегированное действие, и оно
      // попадает в журнал, хотя ответ остаётся неотличимым от «нет такого».
      await this.recordDenied(
        'access_grant.read_denied',
        found?.grant.organizationId ?? null,
        grantId,
        userId,
        found ? 'not_owner' : 'unknown_grant',
      );
      // Чужой грант не показываем как существующий.
      throw AppError.notFound(`Обращение за доступом ${grantId} не найдено`);
    }

    const grant = found.grant;
    if (!grant.active) {
      await this.audit.record({
        action: 'access_grant.read_denied',
        outcome: 'denied',
        organizationId: grant.organizationId,
        resourceType: 'access_grant',
        resourceId: grantId,
        purpose: grant.purpose,
        metadata: { actorId: userId, state: grant.state },
      });

      throw AppError.forbidden(DENIED_MESSAGES[grant.state]);
    }

    return found;
  }

  /** Назначения в объёме гранта. Код случая вместо сведений о человеке. */
  async grantedCases(grantId: string, userId: string): Promise<GrantedCase[]> {
    const { grant } = await this.requireActive(grantId, userId);

    return this.prisma.tenant({ organizationId: grant.organizationId }, async (tx) => {
      // Та же проверка, что и в пути чтения заключения: отзыв или истечение
      // между предварительной проверкой и запросом список уже не выдадут.
      const live = await isGrantLiveFor(tx, {
        organizationId: grant.organizationId,
        grantId,
        userId,
      });
      if (!live) {
        throw AppError.forbidden(
          'Доступ по этому обращению не действует. Оформите новое обращение или попросите продление.',
        );
      }

      const rows = await tx.assignments.findMany({
        where: { organization_id: grant.organizationId, id: { in: grant.scope.assignmentIds } },
        orderBy: { created_at: 'asc' },
        select: {
          id: true,
          state: true,
          scenario_versions: { select: { scenario: { select: { title: true } } } },
          reports: { select: { id: true, status: true } },
        },
      });

      // Использование гранта записывается, а не только отказы: иначе в журнале
      // владельца видны лишь неудачные попытки, а фактическое обращение к
      // выданному доступу — нет (ТЗ 10.4).
      await this.audit.recordIn(tx, {
        action: 'access_grant.cases_listed',
        outcome: 'success',
        organizationId: grant.organizationId,
        resourceType: 'access_grant',
        resourceId: grantId,
        purpose: grant.purpose,
        metadata: { actorId: userId, rows: rows.length },
      });

      return rows.map((row) => ({
        assignmentId: row.id,
        caseCode: caseCodeFor(row.id),
        scenarioTitle: row.scenario_versions.scenario.title,
        assignmentState: row.state,
        reportId: row.reports?.id ?? null,
        reportStatus: row.reports?.status ?? null,
      }));
    });
  }

  /**
   * Чтение заключения назначения по гранту.
   *
   * Назначение вне объёма получает отказ с записью в журнал. Само чтение
   * перепроверяет грант в своей транзакции и пишет аудит атомарно с чтением.
   */
  async readCaseReport(
    grantId: string,
    assignmentId: string,
    userId: string,
  ): Promise<ReportDetail> {
    const { grant } = await this.requireActive(grantId, userId);

    if (!grant.scope.assignmentIds.includes(assignmentId)) {
      await this.audit.record({
        action: 'access_grant.read_denied',
        outcome: 'denied',
        organizationId: grant.organizationId,
        resourceType: 'assignment',
        resourceId: assignmentId,
        purpose: grant.purpose,
        metadata: { actorId: userId, grantId, reason: 'out_of_scope' },
      });

      throw AppError.forbidden(
        'Это назначение не входит в объём выданного доступа. Оформите обращение, в котором оно указано.',
      );
    }

    return this.reports.getForAccessGrant(grant.organizationId, assignmentId, {
      grantId,
      userId,
      purpose: grant.purpose,
    });
  }

  /**
   * Назначения организации для составления объёма обращения.
   *
   * Объём гранта перечисляется назначениями, поэтому администратору нужен их
   * перечень — иначе указать объём нечем. Перечень читается узким резолвером
   * 0016, а не установкой tenant-контекста по идентификатору из пути: иначе в
   * той же транзакции открылись бы ответы, evidence и заключения, а границей
   * служил бы только код. Состав полей фиксирован в базе: код случая вместо
   * имени сотрудника, без состояния назначения и признаков заключения — для
   * выбора объёма они не нужны, а по гранту видны и так (ТЗ 10.4, A03).
   * Чтение перечня само записывается в журнал.
   */
  async listOrganizationAssignments(
    organizationId: string,
    actorId: string,
    query: {
      readonly page: number;
      readonly pageSize: number;
      readonly scenarioCode?: string;
    },
  ): Promise<{ items: AdminAssignmentSummary[]; total: number }> {
    return this.prisma.platformOps(async (tx) => {
      const organization = await tx.organizations.findUnique({
        where: { id: organizationId },
        select: { id: true },
      });

      if (!organization) {
        throw AppError.notFound(`Организация ${organizationId} не найдена`);
      }

      const offset = (query.page - 1) * query.pageSize;
      const scenarioCode = query.scenarioCode ?? null;
      const rows = await resolveOrgAssignmentIndex(tx, organizationId, {
        scenarioCode,
        limit: query.pageSize,
        offset,
      });

      // Общее число приходит окном вместе со строками. Страница за последней
      // записью строк не содержит, поэтому число берётся с первой страницы:
      // иначе пагинация показала бы «ничего нет» вместо «страница пустая».
      const total =
        rows.length > 0
          ? Number(rows[0]!.total_count)
          : offset === 0
            ? 0
            : Number(
                (
                  await resolveOrgAssignmentIndex(tx, organizationId, {
                    scenarioCode,
                    limit: 1,
                    offset: 0,
                  })
                )[0]?.total_count ?? 0,
              );

      await this.audit.recordIn(tx, {
        action: 'admin.assignments_listed',
        outcome: 'success',
        organizationId,
        resourceType: 'organization',
        resourceId: organizationId,
        metadata: { actorId, rows: rows.length },
      });

      return {
        items: rows.map((row) => ({
          assignmentId: row.assignment_id,
          caseCode: caseCodeFor(row.assignment_id),
          scenarioTitle: row.scenario_title,
          scenarioCode: row.scenario_code,
          createdAt: row.created_at.toISOString(),
        })),
        total,
      };
    });
  }

  /**
   * Отзыв собственного доступа администратором.
   *
   * Сужение доступа по собственной инициативе безопасно и прав владельца не
   * требует: отозвать можно только свой грант, и закрывается вся цепочка
   * продлений вместе с ожидающими запросами.
   *
   * Снять можно и собственное нерешённое обращение: заставлять владельца
   * отклонять запрос, от которого заявитель уже отказался сам, незачем — это
   * только засоряет очередь решений (ТЗ A03).
   */
  async revokeOwn(grantId: string, actorId: string): Promise<AccessGrant> {
    const found = await this.findById(grantId);

    if (!found || found.granteeUserId !== actorId) {
      await this.recordDenied(
        'access_grant.revoke_denied',
        found?.grant.organizationId ?? null,
        grantId,
        actorId,
        found ? 'not_owner' : 'unknown_grant',
      );
      throw AppError.notFound(`Обращение за доступом ${grantId} не найдено`);
    }

    const organizationId = found.grant.organizationId;

    await this.prisma.tenant({ organizationId }, async (tx) => {
      const live = await isGrantLiveFor(tx, { organizationId, grantId, userId: actorId });
      if (live) {
        await this.closeChain(tx, organizationId, grantId, {
          actorId,
          purpose: found.grant.purpose,
          granteeId: actorId,
          reason: 'self_revoked',
        });
        return;
      }

      // Нерешённое обращение заявитель снимает сам. Закрывается ровно эта
      // запись: снятие продления не трогает доступ, который им продлевали.
      const withdrawn = await tx.access_grants.updateMany({
        where: {
          id: grantId,
          organization_id: organizationId,
          grantee_user_id: actorId,
          state: 'requested',
        },
        data: { state: 'revoked', revoked_at: new Date() },
      });

      if (withdrawn.count !== 1) {
        throw AppError.conflict(
          'Отзывать нечего: доступ по этому обращению уже не действует. Обновите карточку обращения.',
        );
      }

      await this.audit.recordIn(tx, {
        action: 'access_grant.revoked',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: grantId,
        purpose: found.grant.purpose,
        metadata: {
          approverId: actorId,
          granteeId: actorId,
          previousState: 'requested',
          revokedWith: null,
          reason: 'self_withdrawn',
        },
      });
    });

    return this.byId(grantId);
  }

  // ——— Сторона владельца организации ———

  /** Обращения по организации для владельца: читаются в границах tenant. */
  async listForOrganization(
    organizationId: string,
    query: { readonly page: number; readonly pageSize: number },
  ): Promise<{ items: AccessGrant[]; total: number }> {
    return this.prisma.tenant({ organizationId }, async (tx) => {
      const where = { organization_id: organizationId };

      const [rows, total] = await Promise.all([
        tx.access_grants.findMany({
          where,
          orderBy: [{ requested_at: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: GRANT_SELECT,
        }),
        tx.access_grants.count({ where }),
      ]);

      return { items: rows.map((row) => toGrant(row)), total };
    });
  }

  /**
   * Выдача доступа владельцем организации.
   *
   * Одобрить своё же обращение нельзя, даже если у пользователя есть и роль
   * администратора, и права владельца: это правило держит и сервер, и
   * ограничение БД `approved_by <> requested_by`.
   */
  async approve(
    organizationId: string,
    grantId: string,
    approverId: string,
    input: ApproveAccessGrantInput,
  ): Promise<AccessGrant> {
    const grant = await this.prepareDecision(organizationId, grantId, approverId, 'approve');

    // Согласие с запрошенным сроком — отдельное решение владельца, а не
    // умолчание: без признака выдаётся ровно то, что он указал.
    const hours = input.useRequestedHours ? (grant.requested_hours ?? input.hours) : input.hours;
    if (hours < 1 || hours > ACCESS_GRANT_MAX_HOURS) {
      throw AppError.validation(
        [{ field: 'hours', message: `Срок — от 1 до ${ACCESS_GRANT_MAX_HOURS} часов.` }],
        'Срок доступа указан неверно',
      );
    }

    await this.prisma.tenant({ organizationId }, async (tx) => {
      if (grant.extends_grant_id) {
        // Зависший запрос продления не должен открыть доступ заново после того,
        // как родительский грант уже кончился: срок проверяется по часам базы
        // в этой же транзакции, отдельного состояния «истёк» в БД нет.
        const parent = await this.loadForDecision(tx, organizationId, grant.extends_grant_id);
        const parentLive = await isGrantLiveFor(tx, {
          organizationId,
          grantId: parent.id,
          userId: parent.grantee_user_id,
        });

        if (!parentLive) {
          throw AppError.conflict(
            parent.revoked_at !== null || parent.state === 'revoked'
              ? 'Продлеваемый доступ уже отозван. Продление выдать нельзя — оформите новое обращение.'
              : 'Продлеваемый доступ уже не действует: срок истёк. Оформите новое обращение.',
          );
        }
      }

      // Момент выдачи и срок считает база, а не часы процесса API: живость
      // гранта проверяется по now() базы, и предел «не дольше суток» из
      // ограничения 0014 должен опираться на те же часы. Иначе расхождение
      // часов растянуло бы фактический доступ мимо ограничения (ТЗ A03).
      // Условное обновление: параллельное решение по тому же обращению не пройдёт.
      const updated = await tx.$queryRaw<Array<{ expires_at: Date }>>`
        update core.access_grants
           set state = 'approved',
               approved_by = ${approverId}::uuid,
               approved_at = now(),
               expires_at = now() + make_interval(hours => ${hours}::int),
               decision_note = ${input.note ?? null}::text
         where id = ${grantId}::uuid
           and organization_id = ${organizationId}::uuid
           and state = 'requested'
        returning expires_at
      `;

      const expiresAt = updated[0]?.expires_at;
      if (!expiresAt) {
        throw AppError.conflict('Решение по этому обращению уже принято. Обновите список.');
      }

      await this.audit.recordIn(tx, {
        action: grant.extends_grant_id ? 'access_grant.extended' : 'access_grant.approved',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: grantId,
        purpose: grant.purpose,
        metadata: {
          approverId,
          granteeId: grant.grantee_user_id,
          hours,
          expiresAt: expiresAt.toISOString(),
          extendsGrantId: grant.extends_grant_id,
        },
      });
    });

    return this.byId(grantId);
  }

  async reject(
    organizationId: string,
    grantId: string,
    approverId: string,
    input: RejectAccessGrantInput,
  ): Promise<AccessGrant> {
    const grant = await this.prepareDecision(organizationId, grantId, approverId, 'reject');

    await this.prisma.tenant({ organizationId }, async (tx) => {
      const updated = await tx.access_grants.updateMany({
        where: { id: grantId, organization_id: organizationId, state: 'requested' },
        data: { state: 'rejected', decision_note: input.note },
      });

      if (updated.count !== 1) {
        throw AppError.conflict('Решение по этому обращению уже принято. Обновите список.');
      }

      await this.audit.recordIn(tx, {
        action: 'access_grant.rejected',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: grantId,
        purpose: grant.purpose,
        metadata: {
          approverId,
          granteeId: grant.grantee_user_id,
          extendsGrantId: grant.extends_grant_id,
        },
      });
    });

    return this.byId(grantId);
  }

  /**
   * Отзыв закрывает доступ немедленно: следующее чтение уже не пройдёт.
   *
   * Отзывается вся цепочка продлений: иначе действующее продление оставило бы
   * доступ открытым после отзыва. Ожидающий запрос продления тоже закрывается.
   * Отозвать доступ может любой владелец организации, в том числе сам
   * получатель: сужение доступа безопасно.
   */
  async revoke(
    organizationId: string,
    grantId: string,
    approverId: string,
    input: RevokeAccessGrantInput = {},
  ): Promise<AccessGrant> {
    const target = await this.prepareDecision(organizationId, grantId, approverId, 'revoke');

    if (!isLive(target)) {
      throw AppError.conflict(
        target.state === 'approved' && target.revoked_at === null
          ? 'Срок этого доступа уже истёк: отзывать нечего.'
          : 'Отзывать нечего: доступ по этому обращению не действует. Ожидающий запрос отклоните.',
      );
    }

    await this.prisma.tenant({ organizationId }, async (tx) => {
      await this.closeChain(tx, organizationId, grantId, {
        actorId: approverId,
        purpose: target.purpose,
        granteeId: target.grantee_user_id,
        reason: 'owner_revoked',
        ...(input.note ? { note: input.note } : {}),
      });
    });

    return this.byId(grantId);
  }

  /**
   * Закрытие всей цепочки продлений одним моментом.
   *
   * Общая часть отзыва владельцем и самоотзыва администратором: оставить
   * действующим хотя бы одно звено значило бы, что доступ не закрыт.
   */
  private async closeChain(
    tx: TenantTransaction,
    organizationId: string,
    grantId: string,
    params: {
      readonly actorId: string;
      readonly purpose: string;
      readonly granteeId: string;
      readonly reason: 'owner_revoked' | 'self_revoked';
      readonly note?: string;
    },
  ): Promise<void> {
    const chain = await this.chainOf(tx, organizationId, grantId);
    const now = new Date();

    const closing = await tx.access_grants.findMany({
      where: {
        organization_id: organizationId,
        id: { in: chain },
        revoked_at: null,
        OR: [{ state: 'requested' }, { state: 'approved', expires_at: { gt: now } }],
      },
      select: { id: true, state: true },
    });

    for (const item of closing) {
      const updated = await tx.access_grants.updateMany({
        where: { id: item.id, organization_id: organizationId, state: item.state },
        data: {
          state: 'revoked',
          revoked_at: now,
          ...(item.id === grantId && params.note ? { decision_note: params.note } : {}),
        },
      });

      if (item.id === grantId && updated.count !== 1) {
        throw AppError.conflict('Доступ уже изменён в другом окне. Обновите список.');
      }

      await this.audit.recordIn(tx, {
        action: 'access_grant.revoked',
        outcome: 'success',
        organizationId,
        resourceType: 'access_grant',
        resourceId: item.id,
        purpose: params.purpose,
        metadata: {
          approverId: params.actorId,
          granteeId: params.granteeId,
          previousState: item.state,
          revokedWith: item.id === grantId ? null : grantId,
          reason: params.reason,
        },
      });
    }
  }

  // ——— Общее ———

  async byId(grantId: string): Promise<AccessGrant> {
    const found = await this.findById(grantId);

    if (!found) {
      throw AppError.notFound(`Обращение за доступом ${grantId} не найдено`);
    }

    return found.grant;
  }

  private async findById(grantId: string): Promise<GranteeGrant | null> {
    const row = await this.prisma.platformOps(async (tx) =>
      tx.access_grants.findUnique({ where: { id: grantId }, select: GRANT_SELECT }),
    );

    return row ? { grant: toGrant(row), granteeUserId: row.grantee_user_id } : null;
  }

  /**
   * Общие проверки решения владельца.
   *
   * 1. Решающий — действующий владелец этой организации (`org.manage`).
   *    Маршрут проверяет то же guard'ом; сервис не полагается на это.
   * 2. Обращение принадлежит этой организации.
   * 3. Выдать или отклонить собственное обращение нельзя.
   *
   * Отказы записываются в журнал: неуспешная привилегированная попытка — тоже
   * событие (ТЗ 10.9).
   */
  private async prepareDecision(
    organizationId: string,
    grantId: string,
    approverId: string,
    decision: 'approve' | 'reject' | 'revoke',
  ): Promise<DecisionRow> {
    const memberships = await resolveUserMemberships(this.prisma.preContext, approverId);
    const membership = memberships.find((item) => item.organization_id === organizationId);

    if (!membership) {
      // Решение в организации, к которой пользователь не относится, —
      // привилегированная попытка: ответ остаётся NOT_FOUND, но след есть.
      await this.recordDenied(
        `access_grant.${decision}_denied`,
        organizationId,
        grantId,
        approverId,
        'no_membership',
      );
      // Чужая организация неотличима от несуществующей.
      throw AppError.notFound(
        'Обращение за доступом не найдено в этой организации. Откройте раздел доступов той организации, к которой относится обращение.',
      );
    }

    if (!hasPermission(membership.permissions as OrgPermission[], DECISION_PERMISSION)) {
      await this.recordDenied(
        `access_grant.${decision}_denied`,
        organizationId,
        grantId,
        approverId,
        'missing_permission',
      );
      throw AppError.forbidden(
        'Решать по обращениям за доступом может только владелец организации',
        `Не хватает разрешения ${DECISION_PERMISSION}`,
      );
    }

    const grant = await this.prisma.tenant({ organizationId }, (tx) =>
      this.loadForDecision(tx, organizationId, grantId),
    );

    if (
      decision !== 'revoke' &&
      (grant.requested_by === approverId || grant.grantee_user_id === approverId)
    ) {
      await this.recordDenied(
        `access_grant.${decision}_denied`,
        organizationId,
        grantId,
        approverId,
        'self_approval',
      );
      throw AppError.forbidden(
        'Нельзя принять решение по собственному обращению. Решение принимает другой владелец организации.',
      );
    }

    if (decision !== 'revoke' && grant.state !== 'requested') {
      throw AppError.conflict('Решение по этому обращению уже принято. Обновите список.');
    }

    return grant;
  }

  /**
   * Неуспешная привилегированная попытка в журнале (ТЗ 10.9).
   *
   * Пишутся только технические признаки: кто пытался и по какому правилу
   * отказано. Ни причины обращения, ни имён здесь нет.
   */
  private async recordDenied(
    action: string,
    organizationId: string | null,
    grantId: string,
    actorId: string,
    reason: DeniedReason,
    extra: Readonly<Record<string, string | number | boolean | null>> = {},
  ): Promise<void> {
    await this.audit.record({
      action,
      outcome: 'denied',
      organizationId,
      resourceType: 'access_grant',
      resourceId: grantId,
      metadata: { actorId, reason, ...extra },
    });
  }

  /** Все гранты цепочки продлений: от первого обращения до последнего продления. */
  private async chainOf(
    tx: TenantTransaction,
    organizationId: string,
    grantId: string,
  ): Promise<string[]> {
    let rootId = grantId;
    const seen = new Set<string>([grantId]);

    for (;;) {
      const row = await tx.access_grants.findFirst({
        where: { id: rootId, organization_id: organizationId },
        select: { extends_grant_id: true },
      });
      if (!row?.extends_grant_id || seen.has(row.extends_grant_id)) {
        break;
      }
      rootId = row.extends_grant_id;
      seen.add(rootId);
    }

    const chain = new Set<string>([rootId]);
    let frontier = [rootId];
    while (frontier.length > 0) {
      const children = await tx.access_grants.findMany({
        where: { organization_id: organizationId, extends_grant_id: { in: frontier } },
        select: { id: true },
      });
      frontier = children.map((child) => child.id).filter((id) => !chain.has(id));
      frontier.forEach((id) => chain.add(id));
    }

    return [...chain];
  }

  private async loadForDecision(
    tx: TenantTransaction,
    organizationId: string,
    grantId: string,
  ): Promise<DecisionRow> {
    const grant = await tx.access_grants.findFirst({
      where: { id: grantId, organization_id: organizationId },
      select: DECISION_SELECT,
    });

    if (!grant) {
      throw AppError.notFound(`Обращение за доступом ${grantId} не найдено`);
    }

    return grant;
  }
}

/** Строка перечня назначений: состав колонок задан резолвером 0016, не кодом. */
interface OrgAssignmentIndexRow {
  readonly assignment_id: string;
  readonly scenario_title: string;
  readonly scenario_code: string;
  readonly created_at: Date;
  readonly total_count: bigint;
}

/**
 * Перечень назначений организации узким резолвером (миграция 0016).
 *
 * `core.assignments` закрыта строгой tenant-политикой, в которую режим
 * администратора платформы намеренно не входит. Резолвер — единственный
 * разрешённый обход: он отдаёт фиксированный список псевдонимных колонок и
 * физически не может вернуть ни имени сотрудника, ни содержания.
 */
async function resolveOrgAssignmentIndex(
  tx: TenantTransaction,
  organizationId: string,
  page: {
    readonly scenarioCode: string | null;
    readonly limit: number;
    readonly offset: number;
  },
): Promise<OrgAssignmentIndexRow[]> {
  return tx.$queryRaw<OrgAssignmentIndexRow[]>`
    select * from app.resolve_org_assignment_index(
      ${organizationId}::uuid,
      ${page.scenarioCode}::text,
      ${page.limit}::int,
      ${page.offset}::int
    )
  `;
}

/** Какие из перечисленных назначений существуют в этой организации (миграция 0016). */
async function resolveOrgAssignmentIds(
  tx: TenantTransaction,
  organizationId: string,
  assignmentIds: string[],
): Promise<Set<string>> {
  const rows = await tx.$queryRaw<Array<{ assignment_id: string }>>`
    select * from app.resolve_org_assignment_ids(
      ${organizationId}::uuid,
      ${assignmentIds}::uuid[]
    )
  `;

  return new Set(rows.map((row) => row.assignment_id));
}

/** Действует ли выданный грант прямо сейчас. */
function isLive(row: { state: string; revoked_at: Date | null; expires_at: Date | null }): boolean {
  return (
    row.state === 'approved' &&
    row.revoked_at === null &&
    row.expires_at !== null &&
    row.expires_at.getTime() > Date.now()
  );
}

function toGrant(row: GrantRow): AccessGrant {
  const state = row.state as AccessGrantState;
  const active = isLive(row);
  const expired = state === 'approved' && row.revoked_at === null && !active;

  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationCode: row.organizations.code,
    organizationName: row.organizations.name,
    purpose: row.purpose as AccessGrantPurpose,
    // Истечение не хранится состоянием: доступ закрывается сроком сам.
    state: expired ? 'expired' : state,
    reason: row.reason,
    scope: accessGrantScopeSchema.catch({ assignmentIds: [] }).parse(row.resource_scope),
    requestedBy: {
      userId: row.requester.id,
      displayName: row.requester.display_name ?? 'Администратор платформы',
    },
    requestedAt: row.requested_at.toISOString(),
    approvedBy: row.approver
      ? {
          userId: row.approver.id,
          displayName: row.approver.display_name ?? 'Владелец организации',
        }
      : null,
    approvedAt: row.approved_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    decisionNote: row.decision_note,
    requestedHours: row.requested_hours,
    extendsGrantId: row.extends_grant_id,
    active,
  };
}
