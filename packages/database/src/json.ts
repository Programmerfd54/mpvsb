import type { Prisma } from '../generated/prisma';

/**
 * Приведение значения к типу JSON-колонки.
 *
 * Сериализация выполняется явно: в базу попадает ровно то, что переживает
 * JSON-раунд — без Date, Map, undefined и прочих значений, которые PostgreSQL
 * сохранил бы неожиданным образом.
 */
export function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
