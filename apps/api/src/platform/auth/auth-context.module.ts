import { Global, Module } from '@nestjs/common';

import { AdminGuard } from './guards/admin.guard';
import { ManagerGuard } from './guards/manager.guard';
import { ManagerOrAdminGuard } from './guards/manager-or-admin.guard';
import { ParticipantGuard } from './guards/participant.guard';
import { SessionService } from './session.service';

@Global()
@Module({
  providers: [SessionService, ManagerGuard, ManagerOrAdminGuard, AdminGuard, ParticipantGuard],
  exports: [SessionService, ManagerGuard, ManagerOrAdminGuard, AdminGuard, ParticipantGuard],
})
export class AuthContextModule {}
