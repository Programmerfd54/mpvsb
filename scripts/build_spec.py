#!/usr/bin/env python3
"""Build the portable Claude specification and readable roadmap. Stdlib only."""
from pathlib import Path
import json
import posixpath
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCES = [
    'docs/START_PROMPT.md',
    'TASKS_ROLE2_FRONTEND.md',
    'TASKS_ROLE1_ARCH_SECURITY_DEVOPS.md',
    *[f'docs/spec/{name}' for name in [
        '00-scope.md', '01-product-roles.md', '02-design-system.md',
        '03-manager-pages.md', '04-employee-pages.md', '05-admin-pages.md',
        '06-architecture.md', '07-data-model.md', '08-api-contracts.md',
        '09-assessment-ai.md', '10-security-privacy.md', '11-experiments.md',
        '12-quality-operations.md',
    ]],
    'docs/references/README.md', 'docs/ROADMAP.md', 'docs/TRACEABILITY.md',
    'docs/knowledge/README.md', 'docs/knowledge/DECISIONS.md',
    'docs/knowledge/OPEN_QUESTIONS.md', 'docs/knowledge/GLOSSARY.md',
    'docs/knowledge/CONTRIBUTING.md', 'docs/knowledge/HANDOFF.md',
    'docs/knowledge/CHANGELOG.md', 'docs/knowledge/SOURCES.md', 'CLAUDE.md',
]
STATUS = {
    'todo': 'Не начато', 'in_progress': 'В работе', 'blocked': 'Внешняя блокировка',
    'review': 'На проверке', 'done': 'Готово', 'deferred': 'Отложено',
}
PAGE_TASKS = {
    'M01': ['F-04'], 'M02': ['M-07'], 'M03': ['M-02'], 'M04': ['M-02'],
    'M05': ['M-04','M-05'], 'M06': ['M-06'], 'M07': ['M-06'],
    'M08': ['R-08'], 'M09': ['R-08','R-09'], 'M10': ['S-01','S-05'],
    'M11': ['S-03','S-04','S-05'], 'M12': ['R-12'], 'M13': ['M-01','R-16','Q-01'],
    'M14': ['F-04','M-07'], 'M15': ['R-07'],
    'E01': ['E-01'], 'E02': ['E-02'], 'E03': ['E-03'], 'E04': ['E-03'],
    'E05': ['E-04','E-05'], 'E06': ['E-06'], 'E07': ['E-06'],
    'E08': ['E-02','Q-01'], 'E09': ['E-06'],
    'A01': ['R-11'], 'A02': ['M-01'], 'A03': ['M-01','R-16','Q-03'],
    'A04': ['R-02'], 'A05': ['R-02'], 'A06': ['R-03'], 'A07': ['R-10'],
    'A08': ['R-07'], 'A09': ['R-11'], 'A10': ['R-12'], 'A11': ['R-11'],
    'A12': ['Q-01'], 'A13': ['Q-02','Q-03'], 'A14': ['U-03'],
}


def render_roadmap(data):
    tasks = data['tasks']
    counts = {s: sum(t['status'] == s for t in tasks) for s in STATUS}
    implementation_done = any(t['status'] == 'done' and not t['id'].startswith('D-') for t in tasks)
    progress_note = ('**Разработка начата.** Фактическая готовность определяется статусами и evidence ниже.'
                     if implementation_done else '**Готова документация. Реализация приложения ещё не начата.**')
    out = ['# Roadmap разработки', '',
           '> Генерируется из `docs/roadmap.json`. Редактировать статусы и evidence в JSON, затем запускать `python3 scripts/build_spec.py`.', '',
           progress_note, '',
           'Календарные сроки не выдумываются: неизвестны доступность команды и готовность внешних материалов. Этапы определены зависимостями.', '',
           '## Сводка', '', '| Статус | Задач |', '|---|---:|']
    out += [f'| {STATUS[s]} | {counts[s]} |' for s in STATUS]
    out += ['', '## Как работать', '',
            'Берите незаблокированную задачу с завершёнными зависимостями. Укажите owner и `in_progress`. После проверки заполните evidence и только затем `done`. Внешние условия реального пилота не блокируют synthetic разработку.', '',
            '```mermaid', 'flowchart LR',
            '  D[Документация] --> F[Основа и права]',
            '  F --> U[UI и оболочки]',
            '  F --> R1[Версии методик и синтетический контент]',
            '  U --> M[Назначения]', '  R1 --> M', '  M --> E[Тестирование]',
            '  E --> R[Заключения и рецензия]', '  R --> S[Слепое сравнение]',
            '  R --> Q[Приёмка]', '  S --> Q',
            '  X[Материалы и условия реальных данных] --> P[Реальный пилот]',
            '  Q --> P', '```', '']
    for milestone in data['milestones']:
        out += [f"## {milestone['title']}", '']
        for task in [t for t in tasks if t['milestone'] == milestone['id']]:
            mark = 'x' if task['status'] == 'done' else ' '
            out += [f"- [{mark}] **{task['id']} · {task['title']}** — {STATUS[task['status']]} · {task['priority']}",
                    f"  - Зависимости: {', '.join(task['dependsOn']) or 'нет'}.",
                    '  - Спецификация: ' + ', '.join(f'[{Path(p).name}]({posixpath.relpath(p, "docs")})' for p in task['spec']) + '.',
                    '  - Приёмка: ' + '; '.join(task['acceptance']) + '.']
            if task['blocker']:
                out.append('  - Блокировка: ' + task['blocker'])
            if task['owner']:
                out.append('  - Исполнитель: ' + task['owner'])
            if task['evidence']:
                for e in task['evidence']:
                    out.append('  - Подтверждение: ' + e.get('result', '') + (f" (`{e['path']}`)" if e.get('path') else ''))
                    if e.get('command'):
                        out.append('  - Проверка: `' + e['command'] + '`.')
            out.append('')
    return '\n'.join(out).rstrip() + '\n'


def render_traceability():
    files = {
        'M': 'docs/spec/03-manager-pages.md',
        'E': 'docs/spec/04-employee-pages.md',
        'A': 'docs/spec/05-admin-pages.md',
    }
    out = ['# Связь страниц и задач', '',
           'Каждая строка — страница или семейство состояний, требующее реализации. Наличие строки не означает готовность.', '',
           '| ID | Страница/состояние | Задачи | Спецификация |', '|---|---|---|---|']
    for prefix, path in files.items():
        text = (ROOT / path).read_text()
        for code, title in re.findall(r'^## ([MEA]\d{2})\. (.+)$', text, re.M):
            out.append(f'| {code} | {title.replace("|", "/")} | {", ".join(PAGE_TASKS[code])} | [{Path(path).name}](spec/{Path(path).name}) |')
    return '\n'.join(out) + '\n'


def relocate_links(text, source):
    def replace(match):
        label, target = match.group(1), match.group(2)
        if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#') or target.startswith('/'):
            return match.group(0)
        base, sep, fragment = target.partition('#')
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), base))
        return f'[{label}]({resolved}{sep}{fragment})'
    return re.sub(r'\[([^\]\n]+)\]\(([^)\n]+)\)', replace, text)


def render_bundle():
    out = ['# Полное техническое задание и промпт для Claude', '',
           '**Контекст · версия 1.0 · 16.09.2026**', '',
           'Самодостаточный пакет для разработки: продукт, страницы, дизайн, архитектура, данные, API, методики/AI, безопасность, исследования, приёмка, roadmap и база знаний.', '',
           '> Документ сгенерирован `scripts/build_spec.py`. В репозитории источники истины — модульные файлы. При передаче только этого файла все обязательные тексты находятся ниже; ссылки служат дополнительной навигацией.', '',
           '## Оглавление', '']
    for i, path in enumerate(SOURCES):
        title = (ROOT / path).read_text().splitlines()[0].lstrip('# ').strip()
        out.append(f'{i+1}. [{title}](#section-{i:02})')
    for i, path in enumerate(SOURCES):
        body = relocate_links((ROOT / path).read_text(), path)
        out += ['', '---', '', f'<a id="section-{i:02}"></a>', '', f'*Исходный модуль: `{path}`*', '', body.rstrip()]
    return '\n'.join(out).rstrip() + '\n'


def build():
    data = json.loads((ROOT / 'docs/roadmap.json').read_text())
    (ROOT / 'docs/ROADMAP.md').write_text(render_roadmap(data))
    (ROOT / 'docs/TRACEABILITY.md').write_text(render_traceability())
    (ROOT / 'PROMPT_FOR_CLAUDE.md').write_text(render_bundle())
    print(f'Built roadmap ({len(data["tasks"])} tasks), traceability ({len(PAGE_TASKS)} page/state groups), and standalone prompt.')


if __name__ == '__main__':
    build()
