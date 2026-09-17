import { pino, type Logger } from 'pino';

import { loadConfig } from '../config/env';

/**
 * Структурированный журнал без персональных и секретных сведений.
 * Редактирование полей обязательно: токены, cookie и тексты ответов в журнал не попадают.
 */
const REDACTED_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.body',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  'token',
  'tokenHash',
  'sessionHash',
  'secret',
  'response',
  'answers',
  'content',
];

let cached: Logger | null = null;

export function appLogger(): Logger {
  if (cached) {
    return cached;
  }
  const config = loadConfig();
  cached = pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED_PATHS, censor: '[скрыто]' },
    base: { service: 'api', env: config.APP_ENV },
    // Читаемый вывод только локально; в production строго JSON.
    ...(config.isProduction || config.isTest
      ? {}
      : {
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        }),
  });
  return cached;
}
