import type { BadgeTone } from '@/components/ui/badge';

/**
 * Цвет статуса назначения.
 *
 * Обозначает состояние процесса, а не качество человека: «отменена» и «срок
 * истёк» нейтральны, красным помечается только то, что требует действия.
 */
export function assignmentTone(state: string): BadgeTone {
  switch (state) {
    case 'completed':
      return 'success';
    case 'in_progress':
      return 'accent';
    case 'invited':
      return 'info';
    case 'expired':
      return 'warning';
    default:
      return 'neutral';
  }
}
