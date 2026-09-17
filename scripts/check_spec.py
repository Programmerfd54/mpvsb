#!/usr/bin/env python3
"""Check documentation integrity, not application functionality. Stdlib only."""
from pathlib import Path
import datetime
import hashlib
import json
import re
import sys

from build_spec import ROOT, SOURCES, PAGE_TASKS, STATUS, render_bundle, render_roadmap, render_traceability


def main():
    errors = []
    data = json.loads((ROOT / 'docs/roadmap.json').read_text())
    tasks = data['tasks']
    ids = [t['id'] for t in tasks]
    known = set(ids)
    if len(ids) != len(known):
        errors.append('Duplicate task IDs')
    graph = {t['id']: t['dependsOn'] for t in tasks}
    by_id = {t['id']: t for t in tasks}
    milestones = {m['id'] for m in data['milestones']}
    for t in tasks:
        if t['status'] not in STATUS:
            errors.append(f'{t["id"]}: unknown status')
        if t['milestone'] not in milestones:
            errors.append(f'{t["id"]}: unknown milestone')
        if not t['acceptance']:
            errors.append(f'{t["id"]}: missing acceptance')
        if t['status'] == 'done' and not t['evidence']:
            errors.append(f'{t["id"]}: done without evidence')
        if t['status'] == 'blocked' and not t['blocker']:
            errors.append(f'{t["id"]}: blocked without reason')
        for d in t['dependsOn']:
            if d not in known:
                errors.append(f'{t["id"]}: missing dependency {d}')
            elif t['status'] == 'done' and by_id[d]['status'] != 'done':
                errors.append(f'{t["id"]}: done with unfinished dependency {d}')
        for path in t['spec']:
            if not (ROOT / path).is_file():
                errors.append(f'{t["id"]}: missing spec {path}')
    seen, visiting = set(), set()
    def visit(n):
        if n in visiting:
            errors.append(f'Dependency cycle at {n}')
            return
        if n in seen or n not in graph:
            return
        visiting.add(n)
        for dep in graph[n]:
            visit(dep)
        visiting.remove(n)
        seen.add(n)
    for n in graph:
        visit(n)
    for code, refs in PAGE_TASKS.items():
        for ref in refs:
            if ref not in known:
                errors.append(f'{code}: unknown mapped task {ref}')
    actual_pages = set()
    for path in (ROOT / 'docs/spec').glob('*.md'):
        actual_pages.update(re.findall(r'^## ([MEA]\d{2})\.', path.read_text(), re.M))
    if actual_pages != set(PAGE_TASKS):
        errors.append('Page catalog / traceability mismatch')
    if len(actual_pages) != 38:
        errors.append(f'Expected 38 page/state groups, found {len(actual_pages)}')
    markdown_files = list(ROOT.rglob('*.md'))
    link_count = 0
    for path in markdown_files:
        if any(part in {'node_modules', '.git', '.next'} for part in path.parts):
            continue
        text = path.read_text()
        fence_count = sum(line.startswith('```') for line in text.splitlines())
        if fence_count % 2:
            errors.append(f'Unclosed code fence: {path.relative_to(ROOT)}')
        for target in re.findall(r'\[[^\]\n]+\]\(([^)\n]+)\)', text):
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', target) or target.startswith('#'):
                continue
            dest = target.split('#')[0]
            if not dest:
                continue
            link_count += 1
            if not (path.parent / dest).resolve().exists():
                errors.append(f'Broken link: {path.relative_to(ROOT)} → {dest}')
    checks = [
        ('docs/ROADMAP.md', render_roadmap(data)),
        ('docs/TRACEABILITY.md', render_traceability()),
        ('PROMPT_FOR_CLAUDE.md', render_bundle()),
    ]
    for path, expected in checks:
        if not (ROOT / path).exists() or (ROOT / path).read_text() != expected:
            errors.append(f'Generated file stale: {path}')
    for path in SOURCES:
        if not (ROOT / path).is_file():
            errors.append(f'Missing source module: {path}')
    counts = {s: sum(t['status'] == s for t in tasks) for s in STATUS}
    report = {
        'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scope': 'Documentation structure, internal links, task graph, page coverage and generated file consistency only. Says nothing about whether the application works: for that see npm run build / typecheck / lint / test / test:integration.',
        'result': 'pass' if not errors else 'fail',
        'sourceModules': len(SOURCES), 'taskCount': len(tasks),
        'pageStateGroups': len(actual_pages), 'internalLinksChecked': link_count,
        'statuses': counts,
        'bundleSha256': hashlib.sha256((ROOT / 'PROMPT_FOR_CLAUDE.md').read_bytes()).hexdigest() if (ROOT / 'PROMPT_FOR_CLAUDE.md').exists() else None,
        'errors': errors,
    }
    (ROOT / 'docs/verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
