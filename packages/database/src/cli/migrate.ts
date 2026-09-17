/**
 * Применение SQL-миграций владельцем схемы.
 * Runtime-роли не имеют CREATE/ALTER: их создаёт и настраивает этот скрипт.
 *
 *   npm run db:migrate           — применить новые файлы
 *   npm run db:migrate -- --reset — пересоздать схемы (только не-production)
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConstructionPlans } from 'pg-boss';
import { Client } from 'pg';

import { databaseUrl, isProductionLike, runtimeRolePasswords } from '../env';

/** Схема очереди. Создаётся владельцем: runtime-роли не имеют прав на DDL. */
export const QUEUE_SCHEMA = 'pgboss';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');

const TRACKING_TABLE = `
  create table if not exists public.schema_migrations (
    filename text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  )`;

async function ensureRoles(client: Client): Promise<void> {
  const passwords = runtimeRolePasswords();
  const roles: ReadonlyArray<readonly [string, string]> = [
    ['context_api', passwords.api],
    ['context_worker', passwords.worker],
    ['context_evaluator', passwords.evaluator],
  ];

  for (const [role, password] of roles) {
    // NOINHERIT и отсутствие BYPASSRLS обязательны: политика RLS — граница tenant.
    // CREATE ROLE/ALTER ROLE не принимают bind-параметры, поэтому оператор собирает
    // сам PostgreSQL через format(%I/%L) — без ручного экранирования на стороне Node.
    const { rows: existing } = await client.query<{ exists: boolean }>(
      'select exists(select 1 from pg_roles where rolname = $1) as exists',
      [role],
    );

    if (!existing[0]?.exists) {
      const { rows } = await client.query<{ stmt: string }>(
        `select format('create role %I login noinherit nobypassrls nocreatedb nocreaterole', $1::text) as stmt`,
        [role],
      );
      await client.query(rows[0]!.stmt);
    }

    const { rows } = await client.query<{ stmt: string }>(
      `select format('alter role %I with login noinherit nobypassrls password %L', $1::text, $2::text) as stmt`,
      [role, password],
    );
    await client.query(rows[0]!.stmt);
  }

  // Владелец не должен иметь BYPASSRLS в production-подобных окружениях.
  const { rows } = await client.query<{ rolbypassrls: boolean; rolname: string }>(
    'select rolname, rolbypassrls from pg_roles where rolname = current_user',
  );
  const owner = rows[0];
  if (owner?.rolbypassrls && isProductionLike()) {
    throw new Error(
      `Роль миграций ${owner.rolname} имеет BYPASSRLS. В production используйте владельца без BYPASSRLS.`,
    );
  }
}

/**
 * Установка схемы очереди pg-boss владельцем схемы.
 *
 * Сам worker подключается с `migrate: false`: у роли `context_worker` нет прав
 * CREATE/ALTER, и очередь не должна их требовать (ТЗ 07.10, 10.5).
 */
async function ensureQueueSchema(client: Client): Promise<void> {
  const { rows } = await client.query<{ exists: boolean }>(
    'select exists(select 1 from information_schema.schemata where schema_name = $1) as exists',
    [QUEUE_SCHEMA],
  );

  if (!rows[0]?.exists) {
    await client.query(getConstructionPlans(QUEUE_SCHEMA));
    process.stdout.write(`Создана схема очереди: ${QUEUE_SCHEMA}\n`);
  }

  // Права выдаются каждый раз: новые объекты очереди тоже должны быть доступны.
  const grants = [
    `grant usage on schema ${QUEUE_SCHEMA} to context_worker, context_api`,
    `grant select, insert, update, delete on all tables in schema ${QUEUE_SCHEMA} to context_worker, context_api`,
    `grant usage, select on all sequences in schema ${QUEUE_SCHEMA} to context_worker, context_api`,
    `grant execute on all functions in schema ${QUEUE_SCHEMA} to context_worker, context_api`,
  ];
  for (const statement of grants) {
    await client.query(statement);
  }
}

async function reset(client: Client): Promise<void> {
  if (isProductionLike()) {
    throw new Error('Сброс схемы запрещён в production-подобном окружении.');
  }
  await client.query(`
    drop schema if exists ${QUEUE_SCHEMA} cascade;
    drop schema if exists evaluation cascade;
    drop schema if exists core cascade;
    drop schema if exists identity cascade;
    drop schema if exists platform cascade;
    drop schema if exists app cascade;
    drop table if exists public.schema_migrations;
  `);
  process.stdout.write('Схемы удалены (reset).\n');
}

async function main(): Promise<void> {
  const shouldReset = process.argv.includes('--reset');
  const client = new Client({ connectionString: databaseUrl('migrator') });
  await client.connect();

  try {
    if (shouldReset) {
      await reset(client);
    }

    await ensureRoles(client);
    await client.query(TRACKING_TABLE);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));

    const { rows: applied } = await client.query<{ filename: string; checksum: string }>(
      'select filename, checksum from public.schema_migrations',
    );
    const appliedByName = new Map(applied.map((row) => [row.filename, row.checksum]));

    let count = 0;
    for (const filename of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, filename), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = appliedByName.get(filename);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new Error(
            `Миграция ${filename} уже применена, но файл изменён. Создайте новую миграцию вместо правки старой.`,
          );
        }
        continue;
      }

      // Каждая миграция — одна транзакция: частично применённой схемы не остаётся.
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query(
          'insert into public.schema_migrations (filename, checksum) values ($1, $2)',
          [filename, checksum],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Миграция ${filename} не применена: ${(error as Error).message}`, {
          cause: error,
        });
      }

      process.stdout.write(`Применено: ${filename}\n`);
      count += 1;
    }

    await ensureQueueSchema(client);

    process.stdout.write(
      count === 0 ? 'Новых миграций нет.\n' : `Готово. Применено миграций: ${count}.\n`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
