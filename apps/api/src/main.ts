import 'reflect-metadata';

import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module';
import { loadConfig } from './platform/config/env';
import { ProblemFilter } from './platform/errors/problem.filter';
import { appLogger } from './platform/logging/logger';
import { newRequestId, runWithRequestContext } from './platform/request/request-context';
import { registerCsrf } from './platform/security/csrf';

export async function createApp(): Promise<NestFastifyApplication> {
  const config = loadConfig();
  const logger = appLogger();

  const adapter = new FastifyAdapter({
    // Собственный идентификатор запроса используется и в журнале, и в ответе об ошибке.
    genReqId: () => newRequestId(),
    trustProxy: config.isProduction,
    bodyLimit: 256 * 1024,
  });

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    logger: ['error', 'warn'],
    bufferLogs: true,
  });

  const instance = app.getHttpAdapter().getInstance();

  await instance.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: { 'frame-ancestors': ["'none'"], 'default-src': ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: 'same-origin' },
  });

  await instance.register(fastifyCookie);

  await instance.register(fastifyRateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });

  // Контекст запроса охватывает весь обработчик, включая фильтр ошибок.
  instance.addHook('onRequest', (request, _reply, done) => {
    runWithRequestContext(String(request.id), () => done());
  });

  // Персональные ответы не попадают в общий кэш (ТЗ 06.5).
  instance.addHook('onSend', (_request, reply, payload, done) => {
    void reply.header('cache-control', 'no-store');
    void reply.header('referrer-policy', 'no-referrer');
    done(null, payload);
  });

  registerCsrf(instance);

  app.setGlobalPrefix('api/v1', { exclude: ['health/live', 'health/ready'] });
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();

  logger.info({ env: config.APP_ENV }, 'API инициализирован');
  return app;
}

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await createApp();
  await app.listen(config.API_PORT, config.API_HOST);
  appLogger().info({ port: config.API_PORT }, 'API слушает');
}

// Запуск только при прямом вызове: тесты импортируют createApp.
if (require.main === module) {
  bootstrap().catch((error: unknown) => {
    appLogger().fatal({ err: error }, 'API не запустился');
    process.exitCode = 1;
  });
}
