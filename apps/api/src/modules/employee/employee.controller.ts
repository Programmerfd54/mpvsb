import { Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import {
  uuidSchema,
  type EmployeeAssessment,
  type EmployeeAssessmentDetail,
  type EmployeeParticipationSession,
  type EmployeeProfile,
  type Envelope,
} from '@context/contracts';

import { Actor } from '../../platform/auth/decorators';
import { EmployeeGuard } from '../../platform/auth/guards/employee.guard';
import { currentRequestId, type RequestActor } from '../../platform/request/request-context';
import { sessionCookieName, sessionCookieOptions } from '../../platform/security/cookies';
import { ParticipationService } from '../participant/participation.service';
import { parseInput } from '../../platform/validation/zod.pipe';
import { EmployeeService } from './employee.service';

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { requestId: currentRequestId() } };
}

@Controller('employee')
@UseGuards(EmployeeGuard)
export class EmployeeController {
  constructor(
    private readonly employees: EmployeeService,
    private readonly participation: ParticipationService,
  ) {}

  @Get('profile')
  async profile(@Actor() actor: RequestActor): Promise<Envelope<EmployeeProfile>> {
    return envelope(await this.employees.profile(actor));
  }

  @Get('assessments')
  async assessments(@Actor() actor: RequestActor): Promise<Envelope<EmployeeAssessment[]>> {
    return envelope(await this.employees.assessments(actor));
  }

  @Get('assessments/:assignmentId')
  async assessment(
    @Actor() actor: RequestActor,
    @Param('assignmentId') assignmentId: string,
  ): Promise<Envelope<EmployeeAssessmentDetail>> {
    return envelope(await this.employees.assessment(actor, parseInput(uuidSchema, assignmentId)));
  }

  @Post('assessments/:assignmentId/open')
  async open(
    @Actor() actor: RequestActor,
    @Param('assignmentId') assignmentId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Envelope<EmployeeParticipationSession>> {
    const session = await this.participation.openForEmployee(
      actor,
      parseInput(uuidSchema, assignmentId),
    );
    void reply.setCookie(
      sessionCookieName('participant'),
      session.secret,
      sessionCookieOptions(session.maxAgeSeconds),
    );
    return envelope({ nextPath: '/participant/welcome' });
  }
}
