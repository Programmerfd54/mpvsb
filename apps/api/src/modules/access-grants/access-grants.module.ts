import { Module } from '@nestjs/common';

import { ReportsModule } from '../reports/reports.module';
import { AdminAccessGrantsController, OrgAccessGrantsController } from './access-grants.controller';
import { AccessGrantsService } from './access-grants.service';

/**
 * Временный доступ администратора к данным организации.
 *
 * Обращение создаёт администратор в своём кабинете, решение принимает владелец
 * организации в своём: сервис один, точки входа разные. Чтение заключения идёт
 * через сервис заключений, который перепроверяет грант в своей транзакции.
 */
@Module({
  imports: [ReportsModule],
  controllers: [AdminAccessGrantsController, OrgAccessGrantsController],
  providers: [AccessGrantsService],
  exports: [AccessGrantsService],
})
export class AccessGrantsModule {}
