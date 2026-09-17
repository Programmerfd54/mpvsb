import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { OrgPermission } from '@context/domain';

import { AppError } from '../errors/app-error';
import { currentRequestContext, type RequestActor } from '../request/request-context';

export const PERMISSIONS_KEY = 'context:permissions';

/**
 * Требуемые разрешения внутри организации. Проверяются сервером на каждом запросе,
 * а не только пунктами меню.
 */
export const RequirePermissions = (...permissions: OrgPermission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Действующее лицо запроса из контекста, а не из тела запроса. */
export const Actor = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): RequestActor => {
    const actor = currentRequestContext()?.actor;
    if (!actor) {
      throw AppError.unauthenticated('Actor запрошен вне аутентифицированного контекста');
    }
    return actor;
  },
);

/** Подтверждённая организация. Значение из URL уже сверено с membership. */
export const OrgId = createParamDecorator((_data: unknown, _ctx: ExecutionContext): string => {
  const actor = currentRequestContext()?.actor;
  if (!actor?.organizationId) {
    throw AppError.forbidden('Организация не выбрана', 'organizationId отсутствует в контексте');
  }
  return actor.organizationId;
});
