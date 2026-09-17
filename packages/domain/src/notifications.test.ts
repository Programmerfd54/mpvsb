/**
 * Словарь уведомлений и ключи событий (ТЗ 01.7, M14).
 *
 * Здесь проверяется то, что можно проверить без базы: полнота подписей и
 * заголовков по списку типов, совпадение списка типов с check-constraint
 * миграции 0005 и правила построения ключа дедупликации.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  NOTIFICATION_RESOURCE_TYPES,
  NOTIFICATION_TITLES,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  assignmentExpiryEventKey,
  isNotificationResourceType,
  isNotificationType,
  notificationEventKey,
} from './notifications';

const MIGRATION = fileURLToPath(
  new URL('../../database/migrations/0005_reports.sql', import.meta.url),
);

/** Ограничение на тип ресурса добавлено отдельной миграцией. */
const RESOURCE_MIGRATION = fileURLToPath(
  new URL('../../database/migrations/0019_notification_resource_check.sql', import.meta.url),
);

describe('Словарь типов уведомлений', () => {
  it('у каждого типа есть подпись и заголовок', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TYPE_LABELS[type], `нет подписи для типа ${type}`).toBeTruthy();
      expect(NOTIFICATION_TITLES[type], `нет заголовка для типа ${type}`).toBeTruthy();
    }
  });

  it('лишних ключей в словарях нет', () => {
    expect(Object.keys(NOTIFICATION_TYPE_LABELS).sort()).toEqual([...NOTIFICATION_TYPES].sort());
    expect(Object.keys(NOTIFICATION_TITLES).sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('заголовок не содержит подстановок: пользовательский текст в него не попадает', () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(NOTIFICATION_TITLES[type]).not.toMatch(/[{}$%]/);
      expect(NOTIFICATION_TITLES[type].length).toBeLessThanOrEqual(200);
    }
  });

  it('список типов совпадает с check-constraint в схеме базы', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const table = sql.slice(sql.indexOf('create table core.notifications'));
    const constraint = table.slice(table.indexOf('check (type in ('));
    const listed = [...constraint.slice(0, constraint.indexOf('))')).matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    );

    // Расхождение здесь означает, что продюсер нового типа упрётся в базу,
    // а чтение уведомления неизвестного типа даст 500.
    expect(listed.sort()).toEqual([...NOTIFICATION_TYPES].sort());
  });

  it('распознаёт только известные типы и ресурсы', () => {
    expect(isNotificationType('report_published')).toBe(true);
    expect(isNotificationType('report_deleted')).toBe(false);
    expect(isNotificationResourceType('report')).toBe(true);
    expect(isNotificationResourceType('employee')).toBe(false);
    expect([...NOTIFICATION_RESOURCE_TYPES]).toEqual(['report', 'assignment', 'access_grant']);
  });

  it('список типов ресурса совпадает с check-constraint в схеме базы', () => {
    const sql = readFileSync(RESOURCE_MIGRATION, 'utf8');
    const constraint = sql.slice(sql.indexOf('notifications_resource_type_check'));
    const listed = [...constraint.slice(0, constraint.indexOf('));')).matchAll(/'([a-z_]+)'/g)].map(
      (match) => match[1],
    );

    // Расхождение здесь означает, что чтение уведомления с типом ресурса из
    // базы упадёт как «схема и домен разошлись» — на штатной строке.
    expect(listed.sort()).toEqual([...NOTIFICATION_RESOURCE_TYPES].sort());
  });
});

describe('Ключ дедупликации', () => {
  const eventId = '018f2b1c-0000-7000-8000-000000000001';

  it('собирается из типа и идентификатора события', () => {
    expect(notificationEventKey('report_published', eventId)).toBe(`report_published:${eventId}`);
  });

  it('разные события одного типа дают разные ключи', () => {
    const first = notificationEventKey('report_published', 'revision-1');
    const second = notificationEventKey('report_published', 'revision-2');
    expect(first).not.toBe(second);
  });

  it('предупреждение о сроке привязано к сроку, а не только к назначению', () => {
    const due = new Date('2026-01-10T09:00:00.000Z');
    const extended = new Date('2026-02-10T09:00:00.000Z');

    expect(assignmentExpiryEventKey(eventId, due)).toBe(
      `assignment_expiring:${eventId}:2026-01-10T09:00:00.000Z`,
    );
    // Продление срока — новое событие: иначе предупреждение пришло бы один
    // раз за всю жизнь назначения.
    expect(assignmentExpiryEventKey(eventId, extended)).not.toBe(
      assignmentExpiryEventKey(eventId, due),
    );
    // Повторный расчёт по тому же сроку ключ не меняет.
    expect(assignmentExpiryEventKey(eventId, new Date(due.getTime()))).toBe(
      assignmentExpiryEventKey(eventId, due),
    );
  });

  it('назначение без срока даёт определённый ключ', () => {
    expect(assignmentExpiryEventKey(eventId, null)).toBe(`assignment_expiring:${eventId}:none`);
  });
});
