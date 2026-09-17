import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * Конфигурация Prisma CLI. Подключение для интроспекции и генерации берётся у
 * владельца схемы. Приложение работает под runtime-ролями через driver adapter.
 */
export default defineConfig({
  schema: path.join(__dirname, 'prisma', 'schema.prisma'),
  datasource: {
    url: process.env.DATABASE_URL_MIGRATOR ?? '',
  },
});
