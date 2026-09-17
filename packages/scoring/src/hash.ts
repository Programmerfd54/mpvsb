import { createHash } from 'node:crypto';

/**
 * Каноническая сериализация для хэша входа.
 * Ключи объектов сортируются, поэтому одинаковые данные дают одинаковый хэш
 * независимо от порядка полей в исходной структуре.
 */
export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

/** SHA-256 канонической формы. Доказывает неизменность байтов, не истинность содержания. */
export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
