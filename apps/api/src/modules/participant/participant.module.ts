import { Module } from '@nestjs/common';

import { ParticipantController } from './participant.controller';
import { ParticipationService } from './participation.service';

@Module({
  controllers: [ParticipantController],
  providers: [ParticipationService],
  exports: [ParticipationService],
})
export class ParticipantModule {}
