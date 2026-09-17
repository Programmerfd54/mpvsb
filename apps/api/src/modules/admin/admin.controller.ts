import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';

import {
  adminAuditFilterSchema,
  adminJobFilterSchema,
  createMethodInputSchema,
  createMethodVersionInputSchema,
  createOrganizationInputSchema,
  createReportingPolicyInputSchema,
  createScenarioInputSchema,
  createScenarioVersionInputSchema,
  updateMethodVersionInputSchema,
  updateScenarioVersionInputSchema,
  suspendOrganizationSchema,
  updateReadinessSchema,
  type AdminAuditDetails,
  type AdminAuditEvent,
  type AdminJob,
  type AdminJobDetails,
  type AdminOperationsFacets,
  type AdminMethod,
  type AdminMethodVersion,
  type AdminOrganization,
  type AdminOverview,
  type AdminScenario,
  type AdminScenarioVersion,
  type Envelope,
  type IssuedLink,
  type AvailableMethodVersion,
  type MethodCheckResult,
  type MethodImportPreview,
  type ReadinessCheck,
  type ReportingPolicy,
  type ScenarioIssue,
} from '@context/contracts';
import { CONTENT_VERSION_STATES, type ContentVersionState } from '@context/domain';
import { z } from 'zod';

import { Actor } from '../../platform/auth/decorators';
import { AdminGuard } from '../../platform/auth/guards/admin.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { parseInput } from '../../platform/validation/zod.pipe';
import { AuthService } from '../auth/auth.service';
import { AdminContentService } from './admin-content.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { MethodEditorService } from './method-editor.service';
import { ScenarioEditorService } from './scenario-editor.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

const transitionSchema = z.object({ status: z.enum(CONTENT_VERSION_STATES) });

/**
 * Кабинет администратора платформы.
 *
 * Все маршруты закрыты `AdminGuard`: принимается только сессия администратора,
 * cookie участника и обычного руководителя здесь не подходят. Доступа к
 * содержанию оценок эта роль не даёт (ТЗ 01.2).
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly organizations: AdminOrganizationsService,
    private readonly content: AdminContentService,
    private readonly operations: AdminOperationsService,
    private readonly methodEditor: MethodEditorService,
    private readonly scenarioEditor: ScenarioEditorService,
    private readonly auth: AuthService,
  ) {}

  @Get('overview')
  async overview(): Promise<Envelope<AdminOverview>> {
    return envelope(await this.operations.overview());
  }

  // ——— Организации ———

  @Get('organizations')
  async listOrganizations(): Promise<Envelope<AdminOrganization[]>> {
    return envelope(await this.organizations.list());
  }

  @Post('organizations')
  async createOrganization(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<{ organization: AdminOrganization; ownerActivation: IssuedLink | null }>> {
    const input = parseInput(createOrganizationInputSchema, body);
    const created = await this.organizations.create(input, actor.userId!);
    const organization = await this.organizations.get(created.organizationId);

    // Ссылка активации выпускается только новому владельцу и возвращается один раз.
    let ownerActivation: IssuedLink | null = null;
    if (created.ownerIsNew) {
      const token = await this.auth.issueAccountToken(created.ownerUserId, 'activation');
      ownerActivation = {
        url: `/activate#token=${token.token}`,
        expiresAt: token.expiresAt.toISOString(),
        secretAvailable: true,
      };
    }

    return envelope({ organization, ownerActivation });
  }

  @Get('organizations/:orgId')
  async getOrganization(@Param('orgId') orgId: string): Promise<Envelope<AdminOrganization>> {
    return envelope(await this.organizations.get(orgId));
  }

  @Post('organizations/:orgId/suspend')
  async suspend(
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminOrganization>> {
    const input = parseInput(suspendOrganizationSchema, body);
    return envelope(await this.organizations.setStatus(orgId, 'suspended', input.reason));
  }

  @Post('organizations/:orgId/resume')
  async resume(@Param('orgId') orgId: string): Promise<Envelope<AdminOrganization>> {
    return envelope(await this.organizations.setStatus(orgId, 'active', undefined));
  }

  @Get('organizations/:orgId/readiness')
  async readiness(@Param('orgId') orgId: string): Promise<Envelope<ReadinessCheck[]>> {
    return envelope(await this.organizations.readiness(orgId));
  }

  @Patch('organizations/:orgId/readiness')
  async updateReadiness(
    @Actor() actor: RequestActor,
    @Param('orgId') orgId: string,
    @Body() body: unknown,
  ): Promise<Envelope<ReadinessCheck[]>> {
    const input = parseInput(updateReadinessSchema, body);
    return envelope(await this.organizations.updateReadiness(orgId, input, actor.userId!));
  }

  // ——— Методики ———

  @Get('methods')
  async listMethods(): Promise<Envelope<AdminMethod[]>> {
    return envelope(await this.content.listMethods());
  }

  /** Новая методика вместе с первым черновиком версии. */
  @Post('methods')
  async createMethod(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMethodVersion>> {
    const input = parseInput(createMethodInputSchema, body);
    return envelope(await this.methodEditor.createMethod(input, actor.userId!));
  }

  /** Новая версия существующей методики: опубликованная не редактируется. */
  @Post('methods/:methodId/versions')
  async createMethodVersion(
    @Actor() actor: RequestActor,
    @Param('methodId') methodId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMethodVersion>> {
    const input = parseInput(createMethodVersionInputSchema, body);
    return envelope(await this.methodEditor.createVersion(methodId, input, actor.userId!));
  }

  @Patch('method-versions/:versionId')
  async updateMethodVersion(
    @Actor() actor: RequestActor,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMethodVersion>> {
    const input = parseInput(updateMethodVersionInputSchema, body);
    return envelope(await this.methodEditor.updateDraft(versionId, input, actor.userId!));
  }

  /** Замечания по открытой версии: ссылки шкал, баллы вариантов, диапазоны. */
  @Get('method-versions/:versionId/issues')
  async methodIssues(
    @Param('versionId') versionId: string,
  ): Promise<Envelope<MethodImportPreview['issues']>> {
    return envelope(await this.methodEditor.issuesFor(versionId));
  }

  /** Разбор импортируемого JSON без записи: решение принимает человек. */
  @Post('method-versions/import-preview')
  importPreview(@Body() body: unknown): Envelope<MethodImportPreview> {
    return envelope(this.methodEditor.previewImport(body));
  }

  @Get('method-versions/:versionId')
  async getMethodVersion(
    @Param('versionId') versionId: string,
  ): Promise<Envelope<AdminMethodVersion>> {
    return envelope(await this.content.getMethodVersion(versionId));
  }

  /** Прогон контрольных примеров. Проверяет ключи, а не значимость методики. */
  @Post('method-versions/:versionId/check')
  async checkMethodVersion(
    @Param('versionId') versionId: string,
  ): Promise<Envelope<MethodCheckResult>> {
    return envelope(await this.content.checkMethodVersion(versionId));
  }

  @Post('method-versions/:versionId/transition')
  async transitionMethodVersion(
    @Actor() actor: RequestActor,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminMethodVersion>> {
    const input = parseInput(transitionSchema, body);
    return envelope(
      await this.content.transitionMethodVersion(
        versionId,
        input.status as ContentVersionState,
        actor.userId!,
      ),
    );
  }

  // ——— Сценарии ———

  @Get('scenarios')
  async listScenarios(): Promise<Envelope<AdminScenario[]>> {
    return envelope(await this.content.listScenarios());
  }

  /** Новый сценарий с первым черновиком версии. */
  @Post('scenarios')
  async createScenario(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<AdminScenarioVersion>> {
    const input = parseInput(createScenarioInputSchema, body);
    return envelope(await this.scenarioEditor.createScenario(input, actor.userId!));
  }

  @Post('scenarios/:scenarioId/versions')
  async createScenarioVersion(
    @Actor() actor: RequestActor,
    @Param('scenarioId') scenarioId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminScenarioVersion>> {
    const input = parseInput(createScenarioVersionInputSchema, body);
    return envelope(await this.scenarioEditor.createVersion(scenarioId, input, actor.userId!));
  }

  @Patch('scenario-versions/:versionId')
  async updateScenarioVersion(
    @Actor() actor: RequestActor,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminScenarioVersion>> {
    const input = parseInput(updateScenarioVersionInputSchema, body);
    return envelope(await this.scenarioEditor.updateDraft(versionId, input, actor.userId!));
  }

  @Get('scenario-versions/:versionId/issues')
  async scenarioIssues(@Param('versionId') versionId: string): Promise<Envelope<ScenarioIssue[]>> {
    return envelope(await this.scenarioEditor.issuesFor(versionId));
  }

  /** Версии методик, доступные для включения в сценарий. */
  @Get('available-method-versions')
  async availableMethods(): Promise<Envelope<AvailableMethodVersion[]>> {
    return envelope(await this.scenarioEditor.availableMethods());
  }

  @Get('reporting-policies')
  async listReportingPolicies(): Promise<Envelope<ReportingPolicy[]>> {
    return envelope(await this.scenarioEditor.listReportingPolicies());
  }

  @Post('reporting-policies')
  async createReportingPolicy(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<ReportingPolicy>> {
    const input = parseInput(createReportingPolicyInputSchema, body);
    return envelope(await this.scenarioEditor.createReportingPolicy(input, actor.userId!));
  }

  @Get('scenario-versions/:versionId')
  async getScenarioVersion(
    @Param('versionId') versionId: string,
  ): Promise<Envelope<AdminScenarioVersion>> {
    return envelope(await this.content.getScenarioVersion(versionId));
  }

  @Post('scenario-versions/:versionId/transition')
  async transitionScenarioVersion(
    @Actor() actor: RequestActor,
    @Param('versionId') versionId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminScenarioVersion>> {
    const input = parseInput(transitionSchema, body);
    return envelope(
      await this.content.transitionScenarioVersion(
        versionId,
        input.status as ContentVersionState,
        actor.userId!,
      ),
    );
  }

  // ——— Эксплуатация ———

  /** Значения фильтров: перечисляется только то, что действительно встречается. */
  @Get('operations/facets')
  async facets(): Promise<Envelope<AdminOperationsFacets>> {
    return envelope(await this.operations.facets());
  }

  @Get('jobs')
  async jobs(@Query() query: unknown): Promise<Envelope<AdminJob[]>> {
    const filter = parseInput(adminJobFilterSchema, query);
    return envelope(await this.operations.jobs(filter));
  }

  /** Технические детали задания. Само обращение записывается в аудит. */
  @Get('jobs/:jobId')
  async jobDetails(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
  ): Promise<Envelope<AdminJobDetails>> {
    return envelope(await this.operations.jobDetails(jobId, actor.userId!));
  }

  /**
   * Повтор задания. Условия проверяются заново: отменённое назначение,
   * отозванное согласие и устаревшее поколение данных повтор не пропускают.
   */
  @Post('jobs/:jobId/retry')
  async retryJob(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
  ): Promise<Envelope<AdminJobDetails>> {
    return envelope(await this.operations.retryJob(jobId, actor.userId!));
  }

  @Post('jobs/:jobId/retries')
  async setRetries(
    @Actor() actor: RequestActor,
    @Param('jobId') jobId: string,
    @Body() body: unknown,
  ): Promise<Envelope<AdminJobDetails>> {
    const input = parseInput(z.object({ stopped: z.boolean() }), body);
    return envelope(await this.operations.setRetriesStopped(jobId, input.stopped, actor.userId!));
  }

  @Get('audit')
  async audit(@Query() query: unknown): Promise<Envelope<AdminAuditEvent[]>> {
    const filter = parseInput(adminAuditFilterSchema, query);
    return envelope(await this.operations.auditEvents(filter));
  }

  /** Развёрнутая запись аудита. Скрытые поля показываются именем, не значением. */
  @Get('audit/:eventId')
  async auditDetails(
    @Actor() actor: RequestActor,
    @Param('eventId') eventId: string,
  ): Promise<Envelope<AdminAuditDetails>> {
    return envelope(await this.operations.auditDetails(eventId, actor.userId!));
  }
}
