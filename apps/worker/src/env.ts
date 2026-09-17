import { z } from 'zod';

const schema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  DATABASE_URL_WORKER: z.string().min(1, 'Не задано подключение роли worker к PostgreSQL.'),
  REPORT_PROVIDER: z.enum(['fake', 'template']).default('fake'),
  REPORT_PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600_000).default(60_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Интервал опроса outbox. Диспетчер доставляет события в очередь. */
  DISPATCH_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(1000),
});

export type WorkerConfig = Readonly<z.infer<typeof schema>> & { readonly isProduction: boolean };

let cached: WorkerConfig | null = null;

export function loadWorkerConfig(): WorkerConfig {
  if (cached) {
    return cached;
  }
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Некорректное окружение worker:\n  ${details}`);
  }
  const env = parsed.data;
  cached = Object.freeze({
    ...env,
    isProduction: env.APP_ENV === 'production' || env.APP_ENV === 'staging',
  });
  return cached;
}
