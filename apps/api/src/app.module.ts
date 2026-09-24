import { Module } from '@nestjs/common';

import { AuditModule } from './platform/audit/audit.module';
import { AuthContextModule } from './platform/auth/auth-context.module';
import { PrismaModule } from './platform/database/prisma.module';
import { OutboxModule } from './platform/outbox/outbox.module';
import { AccessGrantsModule } from './modules/access-grants/access-grants.module';
import { AdminModule } from './modules/admin/admin.module';
import { AuthModule } from './modules/auth/auth.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AssignmentsModule } from './modules/assignments/assignments.module';
import { ParticipantModule } from './modules/participant/participant.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ScenariosModule } from './modules/scenarios/scenarios.module';
import { EmployeeModule } from './modules/employee/employee.module';

/**
 * Модульный монолит: предметные модули складываются здесь, платформенные
 * возможности объявлены глобальными, чтобы не дублировать импорты.
 */
@Module({
  imports: [
    PrismaModule,
    OutboxModule,
    AuditModule,
    AuthContextModule,
    HealthModule,
    AuthModule,
    OrganizationsModule,
    EmployeesModule,
    ScenariosModule,
    AssignmentsModule,
    ParticipantModule,
    ReportsModule,
    AdminModule,
    AccessGrantsModule,
    NotificationsModule,
    EmployeeModule,
  ],
})
export class AppModule {}
