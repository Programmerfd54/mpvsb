import { Scale, Stethoscope, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';

import { AuthSplitLayout } from '@/components/layout/auth-layout';

import { LoginForm } from './_components/login-form';

export const metadata: Metadata = { title: 'Вход · Контекст' };

/**
 * Страница входа.
 *
 * Без маркетинговых обещаний точности: это рабочий инструмент, а не витрина.
 * Ограничения платформы показаны до входа, а не спрятаны в сноске.
 */
export default function LoginPage() {
  return (
    <AuthSplitLayout
      title="Рабочее пространство для решений по сотрудникам"
      description="Вы задаёте конкретный вопрос по сотруднику, платформа собирает ответы и рабочие сведения и готовит объяснимую записку с источниками и ограничениями."
      limits={[
        {
          icon: <Scale aria-hidden="true" strokeWidth={1.75} />,
          text: 'Не принимает кадровые решения за вас.',
        },
        {
          icon: <Stethoscope aria-hidden="true" strokeWidth={1.75} />,
          text: 'Не ставит медицинские диагнозы и не оценивает личность.',
        },
        {
          icon: <TrendingUp aria-hidden="true" strokeWidth={1.75} />,
          text: 'Не предсказывает увольнение, успех повышения и окупаемость обучения.',
        },
      ]}
    >
      <LoginForm />
    </AuthSplitLayout>
  );
}
