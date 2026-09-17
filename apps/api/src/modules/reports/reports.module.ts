import { Module } from '@nestjs/common';

import { ReportsController, ReviewsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController, ReviewsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
