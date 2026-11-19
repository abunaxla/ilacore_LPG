import { Suspense } from 'react';
import { Loading, PageShell } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { MfaForm } from './mfa-form';

export default function MfaPage() {
  const t = getMessages().mfa;
  return (
    <PageShell title={t.title}>
      <p className="mb-6">{t.intro}</p>
      <Suspense fallback={<Loading />}>
        <Gate />
      </Suspense>
    </PageShell>
  );
}

async function Gate() {
  await requireMe(['mfa']);
  return <MfaForm />;
}