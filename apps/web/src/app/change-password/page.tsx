import { Suspense } from 'react';
import { Loading, PageShell } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { ChangePasswordForm } from './change-password-form';

export default function ChangePasswordPage() {
  return (
    <PageShell title={getMessages().password.title}>
      <Suspense fallback={<Loading />}>
        <Gate />
      </Suspense>
    </PageShell>
  );
}

async function Gate() {
  const me = await requireMe(['change_password']);
  const t = getMessages().password;
  return (
    <>
      <p className="mb-6">{me.next === 'change_password' ? t.forcedIntro : t.intro}</p>
      <ChangePasswordForm />
    </>
  );
}