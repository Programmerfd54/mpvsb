import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { DashboardService } from './dashboard.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [AuthModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, DashboardService],
  exports: [OrganizationsService, DashboardService],
})
export class OrganizationsModule {}
