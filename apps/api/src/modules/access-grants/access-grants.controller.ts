import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import {
  approveAccessGrantInputSchema,
  createAccessGrantInputSchema,
  extendAccessGrantInputSchema,
  paginationQuerySchema,
  rejectAccessGrantInputSchema,
  revokeAccessGrantInputSchema,
  type AccessGrant,
  type AdminAssignmentSummary,
  type Envelope,
  type GrantedCase,
  type ListEnvelope,
  type ReportDetail,
} from '@context/contracts';
import { SCENARIO_CODES } from '@context/domain';
import { z } from 'zod';

import { Actor, OrgId, RequirePermissions } from '../../platform/auth/decorators';
import { AdminGuard } from '../../platform/auth/guards/admin.guard';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { uuidParam } from '../../platform/validation/uuid-param';
import { parseInput } from '../../platform/validation/zod.pipe';
import { AccessGrantsService } from './access-grants.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

/** Страничный ответ: обрезанный молча список неотличим от пустого. */
function listEnvelopeOf<T>(
  result: { items: T[]; total: number },
  page: number,
  pageSize: number,
): ListEnvelope<T> {
  return {
    data: result.items,
    meta: { requestId: currentRequestId(), page, pageSize, total: result.total },
  };
}

/**
 * Фильтры перечня назначений организации: сортировка и состав полей заданы
 * резолвером в базе. Фильтра по состоянию назначения здесь нет намеренно —
 * состояние в перечень не входит, и подбирать его фильтром тоже нельзя.
 */
const assignmentsQuerySchema = paginationQuerySchema.extend({
  scenarioCode: z.enum(SCENARIO_CODES).optional(),
});

/**
 * Обращения за временным доступом со стороны администратора платформы.
 *
 * Роль администратора сама по себе содержания не открывает: заключение
 * читается только по действующему гранту, в его объёме, с записью в журнал
 * (ТЗ 01.2, 10.4, A03).
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminAccessGrantsController {
  constructor(private readonly grants: AccessGrantsService) {}

  /** Собственные обращения по всем организациям. */
  @Get('access-grants')
  async listOwn(
    @Actor() actor: RequestActor,
    @Query() query: unknown,
  ): Promise<ListEnvelope<AccessGrant>> {
    const parsed = parseInput(paginationQuerySchema, query ?? {});
    const result = await this.grants.listForGrantee(actor.userId!, parsed);
    return listEnvelopeOf(result, parsed.page, parsed.pageSize);
  }

  @Get('organizations/:orgId/access-grants')
  async listOwnForOrganization(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<AccessGrant>> {
    const parsed = parseInput(paginationQuerySchema, query ?? {});
    const result = await this.grants.listForGrantee(actor.userId!, {
      ...parsed,
      organizationId: uuidParam(orgId, 'organizationId'),
    });
    return listEnvelopeOf(result, parsed.page, parsed.pageSize);
  }

  /**
   * Назначения организации: из чего администратор составляет объём обращения.
   *
   * Сама роль содержания не открывает: здесь только код случая, сценарий и
   * дата — ни имени сотрудника, ни состояния назначения, ни заключения.
   * Перечень читается узким резолвером базы, а не tenant-контекстом по
   * идентификатору из пути.
   */
  @Get('organizations/:orgId/assignments')
  async assignments(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<AdminAssignmentSummary>> {
    const parsed = parseInput(assignmentsQuerySchema, query ?? {});
    const result = await this.grants.listOrganizationAssignments(
      uuidParam(orgId, 'organizationId'),
      actor.userId!,
      {
        page: parsed.page,
        pageSize: parsed.pageSize,
        ...(parsed.scenarioCode ? { scenarioCode: parsed.scenarioCode } : {}),
      },
    );
    return listEnvelopeOf(result, parsed.page, parsed.pageSize);
  }

  @Post('organizations/:orgId/access-grants')
  async request(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AccessGrant>> {
    const input = parseInput(createAccessGrantInputSchema, body);
    return envelope(
      await this.grants.request(uuidParam(orgId, 'organizationId'), actor.userId!, input),
    );
  }

  /** Запрос продления: новая запись, решение снова за владельцем организации. */
  @Post('organizations/:orgId/access-grants/:grantId/extend')
  async extend(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AccessGrant>> {
    const input = parseInput(extendAccessGrantInputSchema, body);
    return envelope(
      await this.grants.requestExtension(
        uuidParam(orgId, 'organizationId'),
        uuidParam(grantId, 'grantId'),
        actor.userId!,
        input,
      ),
    );
  }

  /**
   * Отзыв собственного доступа: администратор сдаёт ставший ненужным грант сам.
   *
   * Сужение доступа прав владельца не требует; отзывается вся цепочка продлений.
   */
  @Post('access-grants/:grantId/revoke')
  async revokeOwn(
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
  ): Promise<Envelope<AccessGrant>> {
    return envelope(await this.grants.revokeOwn(uuidParam(grantId, 'grantId'), actor.userId!));
  }

  /** Назначения в объёме действующего гранта: коды случаев, без сведений о людях. */
  @Get('access-grants/:grantId/cases')
  async cases(
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
  ): Promise<Envelope<GrantedCase[]>> {
    return envelope(await this.grants.grantedCases(uuidParam(grantId, 'grantId'), actor.userId!));
  }

  /** Заключение по назначению в объёме гранта. Каждое чтение записывается в журнал. */
  @Get('access-grants/:grantId/cases/:assignmentId/report')
  async report(
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<Envelope<ReportDetail>> {
    return envelope(
      await this.grants.readCaseReport(
        uuidParam(grantId, 'grantId'),
        uuidParam(assignmentId, 'assignmentId'),
        actor.userId!,
      ),
    );
  }
}

/**
 * Решения владельца организации по обращениям за доступом (ТЗ M13).
 *
 * Все маршруты требуют `org.manage`; сервис проверяет это повторно и
 * запрещает решение по собственному обращению.
 */
@Controller('orgs/:orgId/access-grants')
@UseGuards(ManagerGuard)
export class OrgAccessGrantsController {
  constructor(private readonly grants: AccessGrantsService) {}

  @Get()
  @RequirePermissions('org.manage')
  async list(
    @OrgId() organizationId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<AccessGrant>> {
    const parsed = parseInput(paginationQuerySchema, query ?? {});
    const result = await this.grants.listForOrganization(organizationId, parsed);
    return listEnvelopeOf(result, parsed.page, parsed.pageSize);
  }

  /**
   * Разрешить на указанный срок (1–24 ч). Без указания срока выдаётся
   * минимальный; согласие с запрошенным сроком — отдельный признак
   * `useRequestedHours`.
   */
  @Post(':grantId/approve')
  @RequirePermissions('org.manage')
  async approve(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AccessGrant>> {
    const input = parseInput(approveAccessGrantInputSchema, body ?? {});
    return envelope(
      await this.grants.approve(
        organizationId,
        uuidParam(grantId, 'grantId'),
        actor.userId!,
        input,
      ),
    );
  }

  @Post(':grantId/reject')
  @RequirePermissions('org.manage')
  async reject(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AccessGrant>> {
    const input = parseInput(rejectAccessGrantInputSchema, body);
    return envelope(
      await this.grants.reject(organizationId, uuidParam(grantId, 'grantId'), actor.userId!, input),
    );
  }

  /** Отзыв действует немедленно: следующее чтение по гранту уже не пройдёт. */
  @Post(':grantId/revoke')
  @RequirePermissions('org.manage')
  async revoke(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('grantId') grantId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AccessGrant>> {
    const input = parseInput(revokeAccessGrantInputSchema, body ?? {});
    return envelope(
      await this.grants.revoke(organizationId, uuidParam(grantId, 'grantId'), actor.userId!, input),
    );
  }
}
