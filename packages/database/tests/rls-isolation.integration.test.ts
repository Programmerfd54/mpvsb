/**
 * Изоляция организаций и границы ролей БД.
 *
 * Проверки идут под runtime-ролями (context_api / context_worker / context_evaluator),
 * а не под владельцем схемы: тест под владельцем не доказал бы работу RLS.
 */
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, withPlatformOps, withTenant } from '../src/client';
import type { PrismaClient } from '../src/client';

const apiPool = new Pool({ connectionString: process.env.DATABASE_URL_API, max: 2 });
const workerPool = new Pool({ connectionString: process.env.DATABASE_URL_WORKER, max: 1 });
const evaluatorPool = new Pool({ connectionString: process.env.DATABASE_URL_EVALUATOR, max: 1 });

let prisma: PrismaClient;
let orgA = '';
let orgB = '';

async function createOrganization(name: string, code: string): Promise<string> {
  const client = await apiPool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('app.platform_ops','on',true)`);
    const { rows } = await client.query<{ id: string }>(
      'insert into core.organizations (name, code) values ($1, $2) returning id',
      [name, code],
    );
    await client.query('commit');
    return rows[0]!.id;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  prisma = createPrismaClient('api');
  const suffix = Math.random().toString(36).slice(2, 8);
  orgA = await createOrganization('ООО «Синтетика А»', `synth_a_${suffix}`);
  orgB = await createOrganization('ООО «Синтетика Б»', `synth_b_${suffix}`);
});

afterAll(async () => {
  await prisma.$disconnect();
  await Promise.all([apiPool.end(), workerPool.end(), evaluatorPool.end()]);
});

describe('RLS: граница организации', () => {
  it('без контекста организации строки сотрудников не видны', async () => {
    await withTenant(prisma, { organizationId: orgA }, async (tx) => {
      await tx.employees.create({
        data: { organization_id: orgA, display_name: 'Синтетический А1', external_code: 'A-001' },
      });
    });

    const client = await apiPool.connect();
    try {
      const { rows } = await client.query<{ count: string }>(
        'select count(*)::text as count from identity.employees',
      );
      expect(rows[0]!.count).toBe('0');
    } finally {
      client.release();
    }
  });

  it('организация B не видит сотрудников организации A', async () => {
    const inA = await withTenant(prisma, { organizationId: orgA }, (tx) => tx.employees.count());
    const inB = await withTenant(prisma, { organizationId: orgB }, (tx) => tx.employees.count());

    expect(inA).toBeGreaterThan(0);
    expect(inB).toBe(0);
  });

  it('запись чужого organization_id отвергается политикой WITH CHECK', async () => {
    await expect(
      withTenant(prisma, { organizationId: orgB }, (tx) =>
        tx.employees.create({
          data: { organization_id: orgA, display_name: 'Попытка записи в чужой tenant' },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('чтение по чужому идентификатору возвращает пусто, а не запись', async () => {
    const created = await withTenant(prisma, { organizationId: orgA }, (tx) =>
      tx.employees.create({
        data: { organization_id: orgA, display_name: 'Синтетический А2', external_code: 'A-002' },
      }),
    );

    const found = await withTenant(prisma, { organizationId: orgB }, (tx) =>
      tx.employees.findUnique({ where: { id: created.id } }),
    );

    expect(found).toBeNull();
  });

  it('контекст организации не переживает транзакцию на общем пуле', async () => {
    await withTenant(prisma, { organizationId: orgA }, (tx) => tx.employees.count());

    const client = await apiPool.connect();
    try {
      const { rows } = await client.query<{ org: string | null }>(
        `select nullif(current_setting('app.organization_id', true), '') as org`,
      );
      expect(rows[0]!.org).toBeNull();
    } finally {
      client.release();
    }
  });

  it('эксплуатационный режим не открывает ответы участников', async () => {
    await expect(withPlatformOps(prisma, (tx) => tx.answers.count())).resolves.toBe(0);

    await withTenant(prisma, { organizationId: orgA }, async (tx) => {
      const count = await tx.answers.count();
      expect(count).toBe(0);
    });
  });
});

describe('Права ролей БД', () => {
  it('runtime-роли не являются суперпользователями и не обходят RLS', async () => {
    const { rows } = await apiPool.query<{
      rolname: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `select rolname, rolsuper, rolbypassrls from pg_roles
       where rolname in ('context_api','context_worker','context_evaluator')
       order by rolname`,
    );

    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.rolsuper, `${row.rolname} не должна быть суперпользователем`).toBe(false);
      expect(row.rolbypassrls, `${row.rolname} не должна обходить RLS`).toBe(false);
    }
  });

  it('worker не имеет доступа к схеме identity', async () => {
    await expect(workerPool.query('select count(*) from identity.employees')).rejects.toThrow(
      /permission denied for schema identity/i,
    );
  });

  it('worker не имеет доступа к исходам исследования', async () => {
    await expect(workerPool.query('select count(*) from evaluation.outcomes')).rejects.toThrow(
      /permission denied for schema evaluation/i,
    );
  });

  it('api не имеет доступа к исходам исследования', async () => {
    await expect(apiPool.query('select count(*) from evaluation.outcomes')).rejects.toThrow(
      /permission denied for schema evaluation/i,
    );
  });

  it('evaluator читает исходы, но не ответы участников', async () => {
    await expect(
      evaluatorPool.query('select count(*) from evaluation.outcomes'),
    ).resolves.toBeDefined();
    await expect(evaluatorPool.query('select count(*) from core.answers')).rejects.toThrow(
      /permission denied for table answers/i,
    );
  });
});

describe('Резолверы контекста', () => {
  it('worker не может вызвать резолверы пользовательской сессии', async () => {
    await expect(
      workerPool.query('select * from app.resolve_invitation($1)', ['deadbeef']),
    ).rejects.toThrow(/permission denied|does not exist/i);
  });

  it('резолвер приглашения не возвращает несуществующий токен', async () => {
    const { rows } = await apiPool.query('select * from app.resolve_invitation($1)', [
      `absent-${randomUUID()}`,
    ]);
    expect(rows).toHaveLength(0);
  });
});
