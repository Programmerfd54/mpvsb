import 'reflect-metadata';

import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';

import { AdminController } from './admin.controller';

interface RouteDefinition {
  readonly method: RequestMethod;
  readonly path: string;
}

function controllerRoutes(): RouteDefinition[] {
  const prototype = AdminController.prototype as unknown as Record<string, unknown>;

  return Object.getOwnPropertyNames(prototype).flatMap((name) => {
    const handler = prototype[name];
    if (typeof handler !== 'function') {
      return [];
    }
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    return path === undefined || method === undefined ? [] : [{ method, path }];
  });
}

describe('Публичная поверхность технического администратора', () => {
  it('не публикует создание организации и редакторы содержания оценок', () => {
    const routes = controllerRoutes();

    expect(routes).not.toContainEqual({ method: RequestMethod.POST, path: 'organizations' });
    expect(
      routes.filter(({ path }) =>
        /^(methods|method-versions|scenarios|scenario-versions|available-method-versions|reporting-policies)/.test(
          path,
        ),
      ),
    ).toEqual([]);
  });

  it('сохраняет технические маршруты обзора, организаций и аудита', () => {
    const routes = controllerRoutes();

    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'overview' });
    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'workspace' });
    expect(routes).toContainEqual({ method: RequestMethod.PATCH, path: 'workspace' });
    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'departments' });
    expect(routes).toContainEqual({ method: RequestMethod.POST, path: 'departments' });
    expect(routes).toContainEqual({
      method: RequestMethod.POST,
      path: 'departments/:departmentId/managers',
    });
    expect(routes).toContainEqual({
      method: RequestMethod.POST,
      path: 'departments/:departmentId/employees/:employeeId/transfer',
    });
    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'users' });
    expect(routes).toContainEqual({ method: RequestMethod.POST, path: 'users' });
    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'organizations' });
    expect(routes).toContainEqual({ method: RequestMethod.GET, path: 'audit' });
  });
});
