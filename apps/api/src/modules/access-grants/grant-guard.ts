import type { TenantTransaction } from '@context/database';

/**
 * Проверка действующего гранта внутри транзакции чтения.
 *
 * Выполняется в той же транзакции, что и само чтение, и по часам базы: отзыв
 * или истечение срока между предварительной проверкой и чтением доступ уже не
 * пропустят. Фонового задания для истечения не нужно (ТЗ 10.4, A03).
 *
 * Источник правила «грант жив» один — security-definer резолвер
 * `app.resolve_access_grant` из миграции 0009: он уже выражает «выдан, не
 * отозван, срок не истёк». Здесь к нему добавляются только требуемое
 * разрешение и объём, чтобы предикат не был переписан во второй раз.
 *
 * Отдельный файл без зависимостей от сервисов: его используют и модуль грантов,
 * и модуль заключений, не создавая цикла модулей.
 */

/** Единственное разрешение, которое несёт грант. Ничего другого он не открывает. */
export const GRANT_PERMISSION = 'reports.read_granted';

export async function isGrantLiveFor(
  tx: TenantTransaction,
  access: {
    readonly organizationId: string;
    readonly grantId: string;
    readonly userId: string;
    /** Назначение из объёма. Без него проверяется только сам грант. */
    readonly assignmentId?: string;
  },
): Promise<boolean> {
  const assignmentId = access.assignmentId ?? null;

  const rows = await tx.$queryRaw<Array<{ live: boolean }>>`
    select true as live
    from app.resolve_access_grant(${access.userId}::uuid, ${access.organizationId}::uuid) g
    where g.grant_id = ${access.grantId}::uuid
      and ${GRANT_PERMISSION}::text = any(g.permissions)
      and (
        ${assignmentId}::text is null
        or g.resource_scope -> 'assignmentIds' @> jsonb_build_array(${assignmentId}::text)
      )
  `;

  return rows.length > 0;
}
