/**
 * Однократная подготовка пространства и технического администратора.
 *
 * Повторный запуск ничего не меняет: в частности, не сбрасывает пароль.
 * Вторая организация в одной установке этой командой не создаётся.
 */
import { randomBytes } from 'node:crypto';

import argon2 from 'argon2';

import { READINESS_CHECK_KEYS } from '@context/domain';

import { createPrismaClient, withPlatformOps } from '../client';
import { isProductionLike } from '../env';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

function output(message: string): void {
  process.stdout.write(`${message}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name}.`);
  }
  return value;
}

function organizationCode(): string {
  const value = required('BOOTSTRAP_ORGANIZATION_CODE').toLowerCase();
  if (!/^[a-z0-9_]{2,64}$/.test(value)) {
    throw new Error(
      'BOOTSTRAP_ORGANIZATION_CODE: допустимы 2-64 символа: a-z, 0-9 и подчёркивание.',
    );
  }
  return value;
}

function adminEmail(): string {
  const value = required('BOOTSTRAP_ADMIN_EMAIL').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('BOOTSTRAP_ADMIN_EMAIL должен быть корректным адресом электронной почты.');
  }
  return value;
}

function firstPassword(): { value: string; generated: boolean } {
  const configured = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (configured) {
    if (configured.length < 12) {
      throw new Error('BOOTSTRAP_ADMIN_PASSWORD должен содержать не менее 12 символов.');
    }
    return { value: configured, generated: false };
  }
  if (isProductionLike()) {
    throw new Error('В production или staging необходимо задать BOOTSTRAP_ADMIN_PASSWORD.');
  }
  return { value: `Bootstrap-${randomBytes(12).toString('base64url')}`, generated: true };
}

async function main(): Promise<void> {
  const input = {
    organizationName: required('BOOTSTRAP_ORGANIZATION_NAME'),
    organizationCode: organizationCode(),
    adminEmail: adminEmail(),
    adminName: required('BOOTSTRAP_ADMIN_NAME'),
    timezone: process.env.BOOTSTRAP_ORGANIZATION_TIMEZONE?.trim() || 'Europe/Moscow',
  };
  const prisma = createPrismaClient('api');

  try {
    const existing = await withPlatformOps(prisma, async (tx) => {
      const organizations = await tx.organizations.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { created_at: 'asc' },
      });
      if (organizations.length === 0) {
        return null;
      }
      if (organizations.length > 1 || organizations[0]!.code !== input.organizationCode) {
        throw new Error(
          'Установка уже содержит другую организацию. Bootstrap не создаёт и не заменяет tenant.',
        );
      }
      const admin = await tx.users.findUnique({
        where: { email_normalized: input.adminEmail },
        select: { platform_role: true, status: true },
      });
      if (admin?.platform_role !== 'platform_admin' || admin.status !== 'active') {
        throw new Error(
          'Организация уже существует, но указанный технический администратор не активен. Автоматическое исправление запрещено.',
        );
      }
      await tx.workspace_state.upsert({
        where: { singleton: true },
        create: { organization_id: organizations[0]!.id },
        update: { organization_id: organizations[0]!.id },
      });
      return organizations[0]!;
    });

    if (existing) {
      output(`Пространство уже подготовлено: ${existing.name} (${existing.code}).`);
      output('Данные и пароль администратора не изменены.');
      return;
    }

    const password = firstPassword();
    const passwordHash = await argon2.hash(password.value, ARGON2_OPTIONS);

    await withPlatformOps(
      prisma,
      async (tx) => {
        const organization = await tx.organizations.create({
          data: {
            name: input.organizationName,
            code: input.organizationCode,
            timezone: input.timezone,
            mode: 'demo',
            status: 'active',
          },
          select: { id: true },
        });

        await tx.workspace_state.create({
          data: { organization_id: organization.id },
        });

        const user = await tx.users.findUnique({
          where: { email_normalized: input.adminEmail },
          select: { id: true, platform_role: true },
        });
        if (user) {
          throw new Error(
            'Пользователь с BOOTSTRAP_ADMIN_EMAIL уже существует. Проверьте состояние установки вручную.',
          );
        }

        await tx.users.create({
          data: {
            email_normalized: input.adminEmail,
            email_display: input.adminEmail,
            display_name: input.adminName,
            password_hash: passwordHash,
            platform_role: 'platform_admin',
            status: 'active',
            mfa_required: true,
          },
        });

        await tx.readiness_checks.createMany({
          data: READINESS_CHECK_KEYS.map((key) => ({
            organization_id: organization.id,
            check_key: key,
            state: 'pending',
          })),
        });
      },
      { isolationLevel: 'Serializable', timeoutMs: 30_000 },
    );

    output(`Пространство создано: ${input.organizationName} (${input.organizationCode}).`);
    output(`Технический администратор: ${input.adminEmail}`);
    if (password.generated) {
      output(`Одноразово сгенерированный пароль: ${password.value}`);
      output('Сохраните его сейчас: повторный bootstrap пароль не покажет и не изменит.');
    } else {
      output('Пароль взят из BOOTSTRAP_ADMIN_PASSWORD и не выведен.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
