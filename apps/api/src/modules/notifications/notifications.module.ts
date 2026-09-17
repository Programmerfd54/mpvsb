import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Входящие уведомления кабинета. Создают их предметные модули после успешной
 * транзакции своего события; этот модуль отвечает только за чтение, отметку
 * прочитанным и повторную проверку доступа при открытии ресурса.
 */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
