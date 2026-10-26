import { notFound } from 'next/navigation';

import { DesignSystemShowcase } from './showcase';

export const dynamic = 'force-dynamic';

export default function DesignSystemPage() {
  if (process.env.NODE_ENV !== 'development') notFound();
  return <DesignSystemShowcase />;
}
