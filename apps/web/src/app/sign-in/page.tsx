import { PageShell } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { SignInForm } from './sign-in-form';

export default function SignInPage() {
  const t = getMessages().signIn;
  return (
    <PageShell title={t.title}>
      <p className="mb-6">{t.intro}</p>
      <SignInForm />
      <p className="mt-8 border-t-2 border-current pt-4 text-base">{t.handheldNote}</p>
    </PageShell>
  );
}