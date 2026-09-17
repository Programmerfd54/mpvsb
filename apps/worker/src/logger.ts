import { pino, type Logger } from 'pino';

import { loadWorkerConfig } from './env.js';

/** Журнал worker: без ответов участников, текстов заключений и секретов. */
const REDACTED = ['answers', 'response', 'content', 'payload.answers', 'secret', 'token'];

let cached: Logger | null = null;

export function workerLogger(): Logger {
  if (cached) {
    return cached;
  }
  const config = loadWorkerConfig();
  cached = pino({
    level: config.LOG_LEVEL,
    redact: { paths: REDACTED, censor: '[скрыто]' },
    base: { service: 'worker', env: config.APP_ENV },
  });
  return cached;
}
