import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';

import {
  correctionRequestInputSchema,
  paginationQuerySchema,
  publishReportRequestSchema,
  recordDecisionRequestSchema,
  requestRevisionSchema,
  type CorrectionRequestView,
  type Envelope,
  type GenericAcknowledgement,
  type ListEnvelope,
  type ReportDetail,
  type ReportSummary,
} from '@context/contracts';
import { SCENARIO_CODES, type ScenarioCode } from '@context/domain';
import { z } from 'zod';

import { Actor, OrgId, RequirePermissions } from '../../platform/auth/decorators';
import { ManagerGuard } from '../../platform/auth/guards/manager.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { uuidParam } from '../../platform/validation/uuid-param';
import { parseInput } from '../../platform/validation/zod.pipe';
import { ReportsService } from './reports.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

const listQuerySchema = paginationQuerySchema.extend({
  employeeId: z.uuid().optional(),
  scenarioCode: z.enum(SCENARIO_CODES).optional(),
});

@Controller('orgs/:orgId/reports')
@UseGuards(ManagerGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('reports.read')
  async list(
    @OrgId() organizationId: string,
    @Query() query: unknown,
  ): Promise<ListEnvelope<ReportSummary>> {
    const parsed = parseInput(listQuerySchema, query);
    const result = await this.reports.listPublished(organizationId, {
      page: parsed.page,
      pageSize: parsed.pageSize,
      ...(parsed.employeeId ? { employeeId: parsed.employeeId } : {}),
      ...(parsed.scenarioCode ? { scenarioCode: parsed.scenarioCode as ScenarioCode } : {}),
    });

    return {
      data: result.items,
      meta: {
        requestId: currentRequestId(),
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: result.total,
      },
    };
  }

  @Get(':reportId')
  @RequirePermissions('reports.read')
  async get(
    @OrgId() organizationId: string,
    @Param('reportId') reportId: string,
  ): Promise<Envelope<ReportDetail>> {
    return envelope(
      await this.reports.getPublished(organizationId, uuidParam(reportId, 'reportId')),
    );
  }

  /** Данные печатной формы. Права те же, что и на просмотр. */
  @Get(':reportId/print')
  @RequirePermissions('reports.read')
  async print(
    @OrgId() organizationId: string,
    @Param('reportId') reportId: string,
  ): Promise<Envelope<ReportDetail>> {
    return envelope(
      await this.reports.getPublished(organizationId, uuidParam(reportId, 'reportId')),
    );
  }

  @Post(':reportId/decisions')
  @RequirePermissions('reports.read')
  async recordDecision(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(recordDecisionRequestSchema, body);
    await this.reports.recordDecision(
      organizationId,
      uuidParam(reportId, 'reportId'),
      actor.userId!,
      input,
    );
    return envelope({
      acknowledged: true as const,
      message: 'Решение записано. Заключение осталось без изменений.',
    });
  }

  /**
   * Запросы на исправление по заключению — то, куда ведёт уведомление
   * `revision_requested`. Разрешение здесь `reports.review`, а не
   * `reports.read`: разбирает запрос рецензент, и в ответе есть свободный
   * текст обращения, которого нет ни в уведомлении, ни в списке заключений.
   */
  @Get(':reportId/corrections')
  @RequirePermissions('reports.review')
  async listCorrections(
    @OrgId() organizationId: string,
    @Param('reportId') reportId: string,
  ): Promise<Envelope<CorrectionRequestView[]>> {
    // Пагинации нет намеренно: запросов по одному заключению единицы, и
    // рецензенту нужны все сразу (как в очереди рецензента).
    return envelope(
      await this.reports.listCorrections(organizationId, uuidParam(reportId, 'reportId')),
    );
  }

  @Post(':reportId/corrections')
  @RequirePermissions('reports.read')
  async requestCorrection(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<Envelope<{ receiptId: string; message: string }>> {
    const input = parseInput(correctionRequestInputSchema, body);
    const result = await this.reports.requestCorrection(
      organizationId,
      uuidParam(reportId, 'reportId'),
      actor.userId!,
      input,
    );
    return envelope({
      receiptId: result.receiptId,
      message:
        'Запрос принят. Заключение остаётся доступным с отметкой о запросе; при подтверждённой ошибке будет выпущена исправленная версия.',
    });
  }
}

@Controller('orgs/:orgId/reviews')
@UseGuards(ManagerGuard)
export class ReviewsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @RequirePermissions('reports.review')
  async listPending(@OrgId() organizationId: string) {
    return envelope(await this.reports.listPendingReview(organizationId));
  }

  @Get(':reportId')
  @RequirePermissions('reports.review')
  async get(
    @OrgId() organizationId: string,
    @Param('reportId') reportId: string,
  ): Promise<Envelope<ReportDetail>> {
    return envelope(
      await this.reports.getForReview(organizationId, uuidParam(reportId, 'reportId')),
    );
  }

  @Post(':reportId/publish')
  @RequirePermissions('reports.review')
  async publish(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<Envelope<ReportDetail>> {
    const input = parseInput(publishReportRequestSchema, body);
    return envelope(
      await this.reports.publish(
        organizationId,
        uuidParam(reportId, 'reportId'),
        actor.userId!,
        input.checklist,
        input.comment,
      ),
    );
  }

  @Post(':reportId/request-revision')
  @RequirePermissions('reports.review')
  async requestRevision(
    @OrgId() organizationId: string,
    @Actor() actor: RequestActor,
    @Param('reportId') reportId: string,
    @Body() body: unknown,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(requestRevisionSchema, body);
    await this.reports.requestRevision(
      organizationId,
      uuidParam(reportId, 'reportId'),
      actor.userId!,
      input.comment,
    );
    return envelope({ acknowledged: true as const, message: 'Черновик возвращён на доработку' });
  }
}
