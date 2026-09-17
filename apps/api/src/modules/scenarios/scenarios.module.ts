import { Module } from '@nestjs/common';

import { OrganizationsModule } from '../organizations/organizations.module';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

@Module({
  imports: [OrganizationsModule],
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
