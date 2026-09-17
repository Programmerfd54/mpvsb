import type { ReportDraft, ReportInput, ReportProvider } from './types';
import { TemplateReportProvider } from './template-provider';

/**
 * Демонстрационный провайдер.
 *
 * Выдаёт детерминированный результат на основе тех же правил, что и шаблонный,
 * но помечает его режимом `fake`. Допустим только в demo-режиме: подменять им
 * реальную подготовку заключения нельзя, и worker этого не делает даже при сбое.
 */
export class FakeReportProvider implements ReportProvider {
  readonly name = 'fake';
  readonly generationMode = 'fake' as const;

  private readonly template = new TemplateReportProvider();

  async generate(input: ReportInput, signal: AbortSignal): Promise<ReportDraft> {
    const draft = await this.template.generate(input, signal);
    return {
      content: {
        ...draft.content,
        limitations: [
          'Демонстрационный пример на синтетических данных. Прогностическая точность не проверялась.',
          ...draft.content.limitations,
        ],
      },
      generationMode: this.generationMode,
      modelVersion: null,
      promptVersion: null,
    };
  }
}
