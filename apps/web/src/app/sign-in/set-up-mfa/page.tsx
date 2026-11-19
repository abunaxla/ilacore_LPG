import { Suspense } from 'react';
import { Loading, PageShell } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { MfaSetup } from './mfa-setup';

export default function SetUpMfaPage() {
  return (
    <PageShell title={getMessages().mfaSetup.title}>
      <Suspense fallback={<Loading />}>
        <Gate />
      </Suspense>
    </PageShell>
  );
}

async function Gate() {
  // Also allowed once set-up is done, so the recovery codes stay on screen after confirming.
  await requireMe(['mfa_setup', 'change_password']);
  return <MfaSetup />;
}