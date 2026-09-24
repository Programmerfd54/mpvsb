import { Body, Controller, Get, Param, Patch, Post, Put, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import {
  exchangeInvitationRequestSchema,
  giveConsentRequestSchema,
  privacyRequestInputSchema,
  saveAnswerRequestSchema,
  submitAttemptRequestSchema,
  type Envelope,
  type GenericAcknowledgement,
  type ParticipantAttemptDetail,
  type ParticipantAttemptSummary,
  type ParticipantCompletion,
  type PrivacyReceipt,
  type ParticipantSession,
  type ParticipantTerms,
  type SaveAnswerResult,
  type SubmitAttemptResult,
} from '@context/contracts';

import { Actor } from '../../platform/auth/decorators';
import { ParticipantGuard } from '../../platform/auth/guards/participant.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import {
  clearedCookieOptions,
  sessionCookieName,
  sessionCookieOptions,
} from '../../platform/security/cookies';
import { parseInput } from '../../platform/validation/zod.pipe';
import { ParticipationService } from './participation.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

@Controller('participant')
export class ParticipantController {
  constructor(private readonly participation: ParticipationService) {}

  /**
   * Обмен токена на сессию. Отдельная POST-операция: открытие ссылки само
   * по себе ничего не активирует и не расходует приглашение.
   */
  @Post('exchange')
  async exchange(
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(exchangeInvitationRequestSchema, body);
    const session = await this.participation.exchangeInvitation(input.token);

    void reply.setCookie(
      sessionCookieName('participant'),
      session.secret,
      sessionCookieOptions(session.maxAgeSeconds),
    );

    return envelope({ acknowledged: true as const, message: 'Приглашение открыто' });
  }

  @Get('session')
  @UseGuards(ParticipantGuard)
  async session(@Actor() actor: RequestActor): Promise<Envelope<ParticipantSession>> {
    return envelope(await this.participation.session(actor));
  }

  @Get('terms')
  @UseGuards(ParticipantGuard)
  async terms(@Actor() actor: RequestActor): Promise<Envelope<ParticipantTerms>> {
    return envelope(await this.participation.terms(actor));
  }

  @Post('consents')
  @UseGuards(ParticipantGuard)
  async giveConsent(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<GenericAcknowledgement>> {
    const input = parseInput(giveConsentRequestSchema, body);
    await this.participation.giveConsent(actor, input.documentVersionId, input.documentHash);
    return envelope({ acknowledged: true as const, message: 'Согласие сохранено' });
  }

  @Post('decline')
  @UseGuards(ParticipantGuard)
  async decline(
    @Actor() actor: RequestActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<GenericAcknowledgement>> {
    await this.participation.decline(actor);
    void reply.setCookie(sessionCookieName('participant'), '', clearedCookieOptions());
    return envelope({
      acknowledged: true as const,
      message: 'Мы записали ваш отказ. Спасибо, что сообщили.',
    });
  }

  @Get('attempts')
  @UseGuards(ParticipantGuard)
  async listAttempts(@Actor() actor: RequestActor): Promise<Envelope<ParticipantAttemptSummary[]>> {
    return envelope(await this.participation.listAttempts(actor));
  }

  @Get('attempts/:attemptId')
  @UseGuards(ParticipantGuard)
  async getAttempt(
    @Actor() actor: RequestActor,
    @Param('attemptId') attemptId: string,
  ): Promise<Envelope<ParticipantAttemptDetail>> {
    return envelope(await this.participation.getAttempt(actor, attemptId));
  }

  @Post('attempts/:attemptId/start')
  @UseGuards(ParticipantGuard)
  async startAttempt(
    @Actor() actor: RequestActor,
    @Param('attemptId') attemptId: string,
  ): Promise<Envelope<ParticipantAttemptDetail>> {
    return envelope(await this.participation.startAttempt(actor, attemptId));
  }

  @Put('attempts/:attemptId/answers/:itemId')
  @UseGuards(ParticipantGuard)
  async saveAnswer(
    @Actor() actor: RequestActor,
    @Param('attemptId') attemptId: string,
    @Param('itemId') itemId: string,
    @Body() body: unknown,
  ): Promise<Envelope<SaveAnswerResult>> {
    const input = parseInput(saveAnswerRequestSchema, body);
    return envelope(
      await this.participation.saveAnswer(
        actor,
        attemptId,
        itemId,
        input.response,
        input.expectedRevision,
      ),
    );
  }

  @Patch('attempts/:attemptId/position')
  @UseGuards(ParticipantGuard)
  async updatePosition(
    @Actor() actor: RequestActor,
    @Param('attemptId') attemptId: string,
  ): Promise<Envelope<ParticipantAttemptDetail>> {
    return envelope(await this.participation.getAttempt(actor, attemptId));
  }

  @Post('attempts/:attemptId/submit')
  @UseGuards(ParticipantGuard)
  async submitAttempt(
    @Actor() actor: RequestActor,
    @Param('attemptId') attemptId: string,
    @Body() body: unknown,
  ): Promise<Envelope<SubmitAttemptResult>> {
    const input = parseInput(submitAttemptRequestSchema, body);
    return envelope(
      await this.participation.submitAttempt(actor, attemptId, input.expectedRevision),
    );
  }

  @Get('completion')
  @UseGuards(ParticipantGuard)
  async completion(@Actor() actor: RequestActor): Promise<Envelope<ParticipantCompletion>> {
    return envelope(await this.participation.completion(actor));
  }

  @Post('privacy-requests')
  @UseGuards(ParticipantGuard)
  async createPrivacyRequest(
    @Actor() actor: RequestActor,
    @Body() body: unknown,
  ): Promise<Envelope<PrivacyReceipt>> {
    const input = parseInput(privacyRequestInputSchema, body);
    return envelope(await this.participation.createPrivacyRequest(actor, input));
  }

  @Post('logout')
  @UseGuards(ParticipantGuard)
  async logout(
    @Actor() actor: RequestActor,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<GenericAcknowledgement>> {
    await this.participation.logout(actor);
    void reply.setCookie(sessionCookieName('participant'), '', clearedCookieOptions());
    return envelope({ acknowledged: true as const, message: 'Сеанс завершён' });
  }
}
