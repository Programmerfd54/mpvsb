import { z } from 'zod';

/**
 * Конфигурация процесса. Проверяется один раз при старте: приложение не поднимается
 * с неполным окружением вместо того, чтобы падать на первом запросе.
 * Секреты не логируются и не попадают в ответы.
 */
const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /**
   * Адрес прослушивания. По умолчанию только loopback: наружу API выходит через
   * общий reverse proxy. В контейнере задаётся 0.0.0.0, а публикацию порта
   * ограничивает сеть оркестратора, а не приложение.
   */
  API_HOST: z
    .union([z.ipv4(), z.ipv6()], {
      error:
        'API_HOST должен быть IP-адресом (например, 127.0.0.1 или 0.0.0.0). Имя хоста, в том числе localhost, не принимается: адрес прослушивания не разрешается через DNS.',
    })
    .default('127.0.0.1'),
  WEB_ORIGIN: z.url().default('http://localhost:3000'),

  DATABASE_URL_API: z.string().min(1, 'Не задано подключение роли API к PostgreSQL.'),

  /** Секрет HMAC для хэширования токенов приглашений и сессий. */
  TOKEN_HASH_SECRET: z.string().min(32, 'TOKEN_HASH_SECRET должен быть не короче 32 символов.'),

  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  REPORT_PROVIDER: z.enum(['fake', 'template']).default('fake'),

  EVALUATOR_INTERNAL_URL: z.url().default('http://127.0.0.1:3002'),
  EVALUATOR_SIGNING_KEY: z.string().min(32).optional(),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly isProduction: boolean;
  readonly isTest: boolean;
};

let cached: AppConfig | null = null;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(корень)'}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Некорректное окружение API:\n  ${details}`);
  }

  const env = parsed.data;
  cached = Object.freeze({
    ...env,
    isProduction: env.APP_ENV === 'production' || env.APP_ENV === 'staging',
    isTest: env.APP_ENV === 'test',
  });
  return cached;
}

/** Только для тестов: сбрасывает кэш между сценариями. */
export function resetConfigCache(): void {
  cached = null;
}
