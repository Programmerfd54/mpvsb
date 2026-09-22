import { notFound } from 'next/navigation';

import { MOCK_SCREENS } from '../catalog';
import { MockupView } from '../view';

export default async function MockupPage({ params }: { params: Promise<{ screen: string }> }) {
  if (process.env.NODE_ENV !== 'development') notFound();
  const { screen: id } = await params;
  const screen = MOCK_SCREENS.find((item) => item.id === id);
  if (!screen) notFound();
  return <MockupView screen={screen} />;
}
