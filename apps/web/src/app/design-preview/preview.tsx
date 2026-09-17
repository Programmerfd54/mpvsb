'use client';

import { useState } from 'react';
import { CalendarDays, ClipboardList } from 'lucide-react';

import type { AnswerResponse, MethodItem } from '@context/contracts';

import { EvidenceBrowser } from '@/components/reports/evidence-browser';
import { Button } from '@/components/ui/button';
import { ItemsEditor } from '@/app/(admin)/admin/methods/[versionId]/_components/items-editor';
import { QuestionRenderer } from '@/components/assessment/question-renderer';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DateField } from '@/components/ui/date-field';
import { Field } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';

const examples: MethodItem[] = [
  {
    id: 'item_demo_agreement',
    type: 'likert',
    required: true,
    prompt: 'Мне понятно, какого результата от меня ожидают.',
    min: 1,
    max: 5,
    labels: [
      { value: 1, label: 'Совсем не согласен' },
      { value: 2, label: 'Скорее не согласен' },
      { value: 3, label: 'И да, и нет' },
      { value: 4, label: 'Скорее согласен' },
      { value: 5, label: 'Полностью согласен' },
    ],
  },
  {
    id: 'item_demo_support',
    type: 'multiple_choice',
    required: true,
    prompt: 'Что помогает вам справляться с новой задачей?',
    minSelected: 1,
    maxSelected: 2,
    options: [
      { id: 'opt_demo_plan', label: 'Понятный план действий' },
      { id: 'opt_demo_feedback', label: 'Обратная связь коллег' },
      { id: 'opt_demo_time', label: 'Время на самостоятельную работу' },
    ],
  },
  {
    id: 'item_demo_text',
    type: 'short_text',
    required: false,
    prompt: 'Что вы хотели бы уточнить перед началом работы?',
    maxLength: 1000,
  },
  {
    id: 'item_demo_number',
    type: 'numeric',
    required: true,
    prompt: 'Сколько рабочих встреч запланировано на неделю?',
    min: 0,
    max: 20,
    step: 1,
  },
];

export function DesignPreview() {
  const [source, setSource] = useState<string | null>(null);
  const [items, setItems] = useState(examples);
  const [answer, setAnswer] = useState<AnswerResponse>();
  const [date, setDate] = useState('');
  const [boundedDate, setBoundedDate] = useState('');
  return (
    <main id="main" className="mx-auto max-w-[1240px] px-4 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 max-w-3xl">
        <Badge tone="info">Локальный предпросмотр · синтетические примеры</Badge>
        <h1 className="mt-4">Меньше усилий. Больше ясности.</h1>
        <p className="mt-3 text-[var(--text-secondary)]">
          Рабочие компоненты редизайна: вопрос участника, календарь и конструктор. Здесь можно
          попробовать интерфейс — изменения не записываются в базу.
        </p>
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            icon={<ClipboardList />}
            eyebrow="Для участника"
            title="Один вопрос — один понятный шаг"
          />
          <CardBody className="flex flex-col gap-5">
            <Progress completed={answer ? 1 : 0} total={1} label="Ответов заполнено" />
            <h2 className="text-xl font-semibold leading-relaxed">{examples[0]!.prompt}</h2>
            <QuestionRenderer item={examples[0]!} value={answer} onChange={setAnswer} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            icon={<CalendarDays />}
            tint="peach"
            eyebrow="Общие компоненты"
            title="Понятный выбор даты"
            description="Календарь работает мышью и клавиатурой. Неделя начинается с понедельника."
          />
          <CardBody className="flex flex-col gap-4">
            <Field label="Дата следующей встречи">
              {({ inputId }) => <DateField id={inputId} value={date} onChange={setDate} />}
            </Field>
            <Field
              label="Дата в ограниченном диапазоне"
              hint="В этом примере доступны только 10–20 декабря 2026 года."
            >
              {({ inputId, describedBy }) => (
                <DateField
                  id={inputId}
                  value={boundedDate}
                  onChange={setBoundedDate}
                  min="2026-12-10"
                  max="2026-12-20"
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
              Стрелки перемещают фокус по дням, Page Up / Page Down меняют месяц, Escape закрывает
              календарь.
            </p>
          </CardBody>
        </Card>
      </div>
      <section className="mt-10">
        <p className="eyebrow mb-2 text-[var(--accent)]">Для рецензента · синтетический пример</p>
        <h2 className="mb-5 text-2xl font-semibold">Вывод и источник рядом</h2>
        <div className="grid gap-6 lg:grid-cols-2 items-start">
          <Card>
            <CardHeader title="Основание для обсуждения" />
            <CardBody className="flex flex-col gap-4">
              <Badge tone="neutral">Самоотчёт участника</Badge>
              <p className="text-base leading-relaxed">
                В ответах участник отмечает, что ему помогает заранее согласованный план работы.
              </p>
              <p className="text-sm text-[var(--text-secondary)]">
                Это повод уточнить ожидания в разговоре, а не оценка способностей сотрудника.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button variant="secondary" onClick={() => setSource('ev_demo_answer')}>
                  Ответ участника
                </Button>
                <Button variant="secondary" onClick={() => setSource('ev_demo_context')}>
                  Контекст задачи
                </Button>
              </div>
            </CardBody>
          </Card>
          <EvidenceBrowser
            selectedCode={source}
            onSelect={setSource}
            evidence={[
              {
                evidenceCode: 'ev_demo_answer',
                kind: 'self_report',
                kindLabel: 'Ответ участника',
                collectedAt: '2026-09-17T09:00:00Z',
                content:
                  'Мне помогает понятный план действий и возможность уточнить ожидания до начала работы.',
                kindLimit: 'Самоотчёт отражает мнение участника на момент заполнения.',
                limitations: ['Синтетический пример. Выводы о реальных людях по нему не делаются.'],
              },
              {
                evidenceCode: 'ev_demo_context',
                kind: 'self_report',
                kindLabel: 'Контекст задачи',
                collectedAt: '2026-09-17T08:00:00Z',
                content: 'Обсуждение организации работы над новой задачей.',
                kindLimit: 'Контекст описывает рабочую ситуацию, а не результат оценки.',
                limitations: ['Синтетические сведения для проверки интерфейса.'],
              },
            ]}
          />
        </div>
      </section>
      <section className="mt-10">
        <p className="eyebrow mb-2 text-[var(--accent)]">Для автора опроса</p>
        <h2 className="mb-5 text-2xl font-semibold">Весь опрос перед глазами</h2>
        <ItemsEditor items={items} onChange={setItems} disabled={false} />
      </section>
    </main>
  );
}
