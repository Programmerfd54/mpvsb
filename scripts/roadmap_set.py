#!/usr/bin/env python3
"""Обновление статуса и доказательств задачи в docs/roadmap.json.

Использование:
  python3 scripts/roadmap_set.py F-01 --status done \
      --evidence '{"kind":"command","command":"npm ci","result":"Установка прошла"}'

Скрипт не выдумывает результат: текст доказательства передаёт исполнитель.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

ROADMAP = pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'roadmap.json'
STATUSES = {'todo', 'in_progress', 'blocked', 'review', 'done', 'deferred'}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('task_id')
    parser.add_argument('--status', choices=sorted(STATUSES))
    parser.add_argument('--owner')
    parser.add_argument('--blocker')
    parser.add_argument('--evidence', action='append', default=[],
                        help='JSON-объект с полями kind/path/command/result')
    parser.add_argument('--replace-evidence', action='store_true',
                        help='Заменить список доказательств вместо добавления')
    args = parser.parse_args()

    data = json.loads(ROADMAP.read_text(encoding='utf-8'))
    task = next((t for t in data['tasks'] if t['id'] == args.task_id), None)
    if task is None:
        print(f'Задача {args.task_id} не найдена.', file=sys.stderr)
        return 1

    if args.status:
        task['status'] = args.status
    if args.owner is not None:
        task['owner'] = args.owner or None
    if args.blocker is not None:
        task['blocker'] = args.blocker or None

    if args.evidence:
        parsed = [json.loads(item) for item in args.evidence]
        task['evidence'] = parsed if args.replace_evidence else task['evidence'] + parsed

    if task['status'] == 'done' and not task['evidence']:
        print(f'{args.task_id}: нельзя закрыть без доказательства.', file=sys.stderr)
        return 1

    data['updatedAt'] = dt.datetime.now(dt.UTC).strftime('%Y-%m-%d')
    ROADMAP.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print(f'{args.task_id}: статус={task["status"]}, доказательств={len(task["evidence"])}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
