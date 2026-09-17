import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ReportsModule } from '../reports/reports.module';
import { AdminContentService } from './admin-content.service';
import { AdminController } from './admin.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminOrganizationsService } from './admin-organizations.service';
import { MethodEditorService } from './method-editor.service';
import { ScenarioEditorService } from './scenario-editor.service';

@Module({
  imports: [AuthModule, ReportsModule],
  controllers: [AdminController],
  providers: [
    AdminOrganizationsService,
    AdminContentService,
    AdminOperationsService,
    MethodEditorService,
    ScenarioEditorService,
  ],
})
export class AdminModule {}
