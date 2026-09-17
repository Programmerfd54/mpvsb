import { z } from 'zod';

import { parseInput } from './zod.pipe';

/**
 * Разбор идентификатора из пути до обращения к базе.
 *
 * Без него неверная строка доходит до приведения `::uuid` в запросе, драйвер
 * отвечает ошибкой типа, и фильтр ошибок превращает её в INTERNAL_ERROR 500 —
 * вместо ответа, объясняющего, что именно в запросе неверно. Поле называется
 * так же, как параметр маршрута, поэтому в ошибке видно, какой идентификатор
 * не разобран.
 */
export function uuidParam(value: string, field: string): string {
  return parseInput(z.object({ [field]: z.uuid() }), { [field]: value })[field] as string;
}
