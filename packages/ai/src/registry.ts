import { FakeReportProvider } from './fake-provider';
import { TemplateReportProvider } from './template-provider';
import type { ReportProvider } from './types';

export type ProviderKey = 'fake' | 'template';

/**
 * Выбор провайдера подготовки заключения.
 *
 * Реальная языковая модель здесь отсутствует намеренно: её нельзя подключить,
 * пока не выбран разрешённый поставщик, не проверены условия обработки данных
 * и не определён контур размещения (ТЗ 09.5, открытый вопрос Q-07).
 */
export function createReportProvider(key: ProviderKey): ReportProvider {
  switch (key) {
    case 'template':
      return new TemplateReportProvider();
    case 'fake':
      return new FakeReportProvider();
  }
}

/** Провайдер `fake` допустим только в демонстрационном режиме организации. */
export function assertProviderAllowedInMode(
  provider: ReportProvider,
  organizationMode: 'demo' | 'research' | 'validated_use',
): void {
  if (provider.generationMode === 'fake' && organizationMode !== 'demo') {
    throw new Error(
      `Провайдер «${provider.name}» допустим только в demo-режиме, а организация работает в режиме «${organizationMode}».`,
    );
  }
}
