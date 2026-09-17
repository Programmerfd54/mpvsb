import { notFound } from 'next/navigation';

import { DesignPreview } from './preview';

/** Local component workbench. No API, accounts or stored answers; unavailable in production. */
export default function DesignPreviewPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DesignPreview />;
}
