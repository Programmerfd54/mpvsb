import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminController } from './admin.controller';
import { AdminDepartmentsService } from './admin-departments.service';
import { AdminOperationsService } from './admin-operations.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminWorkspaceService } from './admin-workspace.service';
import { AdminUsersService } from './admin-users.service';
import { AdminMailService } from './admin-mail.service';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [AdminController],
  providers: [
    AdminOrganizationsService,
    AdminOperationsService,
    AdminWorkspaceService,
    AdminDepartmentsService,
    AdminUsersService,
    AdminMailService,
  ],
})
export class AdminModule {}
