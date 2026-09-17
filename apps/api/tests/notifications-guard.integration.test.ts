/**
 * Граница доступа к уведомлениям на уровне маршрута (ТЗ 06.5, 10.3, M14).
 *
 * Тесты сервиса проверяют RLS и фильтр по получателю, но организацию и
 * membership в бою подтверждает `ManagerGuard`, а `@OrgId()` отдаёт уже
 * проверенное значение. Здесь проверяется именно эта граница: руководитель
 * организации Б обращается по пути организации А, отозванный участник — по
 * пути своей организации, и оба получают NOT_FOUND без признаков существования
 * чужих объектов.
 *
 * Сквозной HTTP-прогон тех же маршрутов живёт в tests/e2e/api/tenant-isolation.spec.ts.
 *
 * Все участники синтетические.
 */
import { randomUUID } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaClient, withPlatformOps, withTenant } from '@context/database';
import type { PrismaClient } from '@context/database';
import { NOTIFICATION_TITLES } from '@context/domain';

import { NotificationsController } from '../src/modules/notifications/notifications.controller';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { ReportsController } from '../src/modules/reports/reports.controller';
import { ReportsService } from '../src/modules/reports/reports.service';
import { AuditService } from '../src/platform/audit/audit.service';
import { ManagerGuard } from '../src/platform/auth/guards/manager.guard';
import { SessionService } from '../src/platform/auth/session.service';
import { PrismaService } from '../src/platform/database/prisma.service';
import { AppError } from '../src/platform/errors/app-error';
import {
  currentRequestContext,
  newRequestId,
  runWithRequestContext,
  type RequestActor,
} from '../src/platform/request/request-context';
import { sessionCookieName } from '../src/platform/security/cookies';

let prisma: PrismaClient;
let guard: ManagerGuard;
let controller: NotificationsController;
let reportsController: ReportsController;
let sessionService: SessionService;

const ids = {
  orgA: '',
  orgB: '',
  managerAId: '',
  managerBId: '',
  revokedId: '',
  notificationId: '',
};

const secrets = { managerA: '', managerB: '', revoked: '' };

/**
 * Контекст запроса в том виде, в каком его видит guard: cookie сессии и
 * организация из пути. Организация из тела запроса сюда не попадает никогда.
 */
function executionContext(secret: string | undefined, orgId: string): ExecutionContext {
  const request = {
    cookies: secret === undefined ? {} : { [sessionCookieName('app')]: secret },
    params: { orgId },
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => NotificationsController.prototype.list,
    getClass: () => NotificationsController,
  } as unknown as ExecutionContext;
}

/** Прохождение границы и работа с уведомлениями в одном контексте запроса. */
async function asManager<T>(
  secret: string,
  orgId: string,
  work: (actor: RequestActor) => Promise<T>,
): Promise<T> {
  return runWithRequestContext(newRequestId(), async () => {
    await guard.canActivate(executionContext(secret, orgId));
    const actor = currentRequestContext()?.actor;
    expect(actor, 'guard обязан положить действующее лицо в контекст запроса').toBeTruthy();
    return work(actor!);
  });
}

async function expectAppError(work: Promise<unknown>, code: string): Promise<AppError> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );

  expect(error, 'ожидалась ошибка, но вызов завершился успешно').toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

beforeAll(async () => {
  prisma = createPrismaClient('api');

  const prismaService = Object.create(PrismaService.prototype) as PrismaService;
  Object.defineProperty(prismaService, 'client', { value: prisma, writable: false });

  sessionService = new SessionService(prismaService);
  const audit = new AuditService(prismaService);
  guard = new ManagerGuard(sessionService, new Reflector());
  controller = new NotificationsController(new NotificationsService(prismaService, audit));
  // Тот же разбор идентификатора проверяется и на соседнем маршруте заключений.
  reportsController = new ReportsController(new ReportsService(prismaService, audit));

  const suffix = randomUUID().slice(0, 8).replace(/-/g, '');

  await withPlatformOps(prisma, async (tx) => {
    const orgA = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Граница А»', code: `guard_a_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.orgA = orgA.id;

    const orgB = await tx.organizations.create({
      data: { name: 'ООО «Синтетика Граница Б»', code: `guard_b_${suffix}`, mode: 'demo' },
      select: { id: true },
    });
    ids.orgB = orgB.id;

    const createUser = async (key: string, name: string): Promise<string> => {
      const user = await tx.users.create({
        data: {
          email_normalized: `guard.${key}.${suffix}@synthetic.invalid`,
          email_display: `guard.${key}.${suffix}@synthetic.invalid`,
          display_name: name,
          status: 'active',
        },
        select: { id: true },
      });
      return user.id;
    };

    ids.managerAId = await createUser('a', 'Руководитель организации А (тест границы)');
    ids.managerBId = await createUser('b', 'Руководитель организации Б (тест границы)');
    ids.revokedId = await createUser('revoked', 'Участник с отозванным доступом (тест границы)');

    await tx.memberships.createMany({
      data: [
        {
          organization_id: orgA.id,
          user_id: ids.managerAId,
          permissions: ['assessments.manage', 'reports.read'],
          status: 'active',
        },
        {
          organization_id: orgB.id,
          user_id: ids.managerBId,
          permissions: ['assessments.manage', 'reports.read'],
          status: 'active',
        },
        {
          organization_id: orgA.id,
          user_id: ids.revokedId,
          permissions: ['reports.read'],
          status: 'revoked',
        },
      ],
    });
  });

  /*
   * Сессии выдаёт тот же сервис, что и вход: в базе хранится только хэш,
   * секрет живёт в памяти теста и никуда не записывается.
   */
  secrets.managerA = (await sessionService.createUserSession(ids.managerAId, 'manager')).secret;
  secrets.managerB = (await sessionService.createUserSession(ids.managerBId, 'manager')).secret;
  secrets.revoked = (await sessionService.createUserSession(ids.revokedId, 'manager')).secret;

  await withTenant(prisma, { organizationId: ids.orgA }, async (tx) => {
    const notification = await tx.notifications.create({
      data: {
        organization_id: ids.orgA,
        recipient_user_id: ids.managerAId,
        type: 'report_published',
        resource_type: null,
        resource_id: null,
        title: NOTIFICATION_TITLES.report_published,
        event_key: `report_published:guard:${suffix}`,
      },
      select: { id: true },
    });
    ids.notificationId = notification.id;
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Граница организации перед уведомлениями', () => {
  it('без cookie сессии маршрут недоступен', async () => {
    await runWithRequestContext(newRequestId(), async () => {
      await expectAppError(
        guard.canActivate(executionContext(undefined, ids.orgA)),
        'UNAUTHENTICATED',
      );
    });
  });

  it('руководитель организации Б не проходит по пути организации А', async () => {
    await runWithRequestContext(newRequestId(), async () => {
      const error = await expectAppError(
        guard.canActivate(executionContext(secrets.managerB, ids.orgA)),
        'NOT_FOUND',
      );
      // Чужая организация неотличима от несуществующей: не 403.
      expect(error.code).not.toBe('FORBIDDEN');
      // Идентификатор чужого уведомления в отказе не появляется.
      expect(error.message).not.toContain(ids.notificationId);
    });
  });

  it('отозванный участник не проходит по пути своей организации', async () => {
    await runWithRequestContext(newRequestId(), async () => {
      await expectAppError(
        guard.canActivate(executionContext(secrets.revoked, ids.orgA)),
        'NOT_FOUND',
      );
    });
  });

  it('несуществующая организация отвечает так же, как чужая', async () => {
    const absentOrgId = '00000000-0000-4000-8000-000000000000';

    const foreign = await runWithRequestContext(newRequestId(), async () =>
      expectAppError(guard.canActivate(executionContext(secrets.managerB, ids.orgA)), 'NOT_FOUND'),
    );
    const absent = await runWithRequestContext(newRequestId(), async () =>
      expectAppError(
        guard.canActivate(executionContext(secrets.managerB, absentOrgId)),
        'NOT_FOUND',
      ),
    );

    expect(foreign.code).toBe(absent.code);
  });

  it('подтверждённая организация приходит из пути, а не из тела запроса', async () => {
    const organizationId = await asManager(
      secrets.managerA,
      ids.orgA,
      async (actor) => actor.organizationId!,
    );

    // Это же значение отдаёт @OrgId() в контроллере.
    expect(organizationId).toBe(ids.orgA);
  });
});

describe('Маршруты уведомлений за границей организации', () => {
  it('свой ящик читается, счётчик считается', async () => {
    const result = await asManager(secrets.managerA, ids.orgA, async (actor) => {
      const list = await controller.list(actor.organizationId!, actor, { filter: 'all' });
      const counter = await controller.unreadCount(actor.organizationId!, actor);
      return { list, counter };
    });

    expect(result.list.data.some((item) => item.id === ids.notificationId)).toBe(true);
    expect(result.counter.data.unread).toBeGreaterThan(0);
  });

  it('чужое уведомление не отмечается и не открывается из своей организации', async () => {
    await asManager(secrets.managerB, ids.orgB, async (actor) => {
      await expectAppError(
        controller.markRead(actor.organizationId!, actor, ids.notificationId),
        'NOT_FOUND',
      );
      await expectAppError(
        controller.open(actor.organizationId!, actor, ids.notificationId),
        'NOT_FOUND',
      );
    });

    // Уведомление организации А осталось непрочитанным.
    const stillUnread = await asManager(secrets.managerA, ids.orgA, async (actor) =>
      controller.list(actor.organizationId!, actor, { filter: 'unread' }),
    );

    expect(stillUnread.data.some((item) => item.id === ids.notificationId)).toBe(true);
  });

  it('«отметить все» не выходит за свою организацию и своего получателя', async () => {
    const result = await asManager(secrets.managerB, ids.orgB, async (actor) =>
      controller.markAllRead(actor.organizationId!, actor),
    );

    expect(result.data.updated).toBe(0);

    const inboxA = await asManager(secrets.managerA, ids.orgA, async (actor) =>
      controller.list(actor.organizationId!, actor, { filter: 'unread' }),
    );

    expect(inboxA.data.some((item) => item.id === ids.notificationId)).toBe(true);
  });
});

describe('Идентификатор из пути разбирается до обращения к базе', () => {
  /*
   * Неверный формат идентификатора обязан давать ошибку, объясняющую, что
   * именно в запросе не так. Без разбора строка доходит до приведения `::uuid`
   * в запросе, драйвер отвечает ошибкой типа, и наружу уходит INTERNAL_ERROR
   * 500 — без объяснения действия и мимо Problem-модели.
   */
  it('уведомление и запросы на исправление отвечают понятной ошибкой, а не внутренней', async () => {
    await asManager(secrets.managerA, ids.orgA, async (actor) => {
      const read = await expectAppError(
        controller.markRead(actor.organizationId!, actor, 'не-uuid'),
        'VALIDATION_FAILED',
      );
      expect(read.fieldErrors[0]?.field).toBe('notificationId');

      const open = await expectAppError(
        controller.open(actor.organizationId!, actor, 'не-uuid'),
        'VALIDATION_FAILED',
      );
      expect(open.fieldErrors[0]?.field).toBe('notificationId');

      const corrections = await expectAppError(
        reportsController.listCorrections(actor.organizationId!, 'abc'),
        'VALIDATION_FAILED',
      );
      expect(corrections.fieldErrors[0]?.field).toBe('reportId');

      const report = await expectAppError(
        reportsController.get(actor.organizationId!, 'abc'),
        'VALIDATION_FAILED',
      );
      expect(report.fieldErrors[0]?.field).toBe('reportId');
    });
  });
});
