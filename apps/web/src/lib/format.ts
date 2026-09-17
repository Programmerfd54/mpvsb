/** Единое форматирование дат и чисел в интерфейсе. */

const DATE_TIME = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const DATE_ONLY = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  return DATE_TIME.format(typeof value === 'string' ? new Date(value) : value);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  return DATE_ONLY.format(typeof value === 'string' ? new Date(value) : value);
}

/** «Осталось 3 дня» — без обещаний точного времени обработки. */
export function formatRemaining(value: string | null | undefined): string {
  if (!value) {
    return 'Срок не задан';
  }
  const diffMs = new Date(value).getTime() - Date.now();
  if (diffMs <= 0) {
    return 'Срок истёк';
  }
  const days = Math.floor(diffMs / 86_400_000);
  if (days >= 1) {
    return `Осталось ${days} ${plural(days, 'день', 'дня', 'дней')}`;
  }
  const hours = Math.max(1, Math.floor(diffMs / 3_600_000));
  return `Осталось ${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

export function formatCount(count: number, one: string, few: string, many: string): string {
  return `${count} ${plural(count, one, few, many)}`;
}
