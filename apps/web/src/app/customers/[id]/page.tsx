import Link from 'next/link';
import { Suspense } from 'react';
import { ActionForm } from '@/components/action-form';
import { AppFrame } from '@/components/app-frame';
import { Field } from '@/components/fields';
import { Loading } from '@/components/page-shell';
import { errorText, getMessages } from '@/i18n';
import { requireMe } from '@/lib/auth';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';
import { resendCheckAction, verifyPhoneAction } from '../actions';
import { showPhone, type CustomerSummary } from '../data';

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

export default function CustomerPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <Suspense fallback={<Loading />}>
      <Customer params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Customer({ params, searchParams }: { params: Params; searchParams: Search }) {
  const me = await requireMe();
  const c = getMessages().customers;
  const { id } = await params;
  const added = (await searchParams)['added'] === '1';
  const reply = await api<CustomerSummary>(`/customers/${encodeURIComponent(id)}`, { token: await getToken() });
  if (!reply.ok) {
    return (
      <AppFrame me={me} title={c.title}>
        <p role="alert" className="mb-6 rounded-md border-2 border-current p-4">{errorText(reply.error)}</p>
        <Link href="/customers" className="underline underline-offset-4">{c.back}</Link>
      </AppFrame>
    );
  }
  const shop = reply.data;

  return (
    <AppFrame me={me} title={shop.name}>
      <p className="mb-6">
        <Link href="/customers" className="underline underline-offset-4">{c.back}</Link>
      </p>
      {added && !shop.phoneVerified ? (
        <p role="status" className="mb-6 rounded-md border-2 border-dashed border-current p-3">
          <span aria-hidden="true">✓ </span>
          {c.added}
        </p>
      ) : null}

      <dl className="mb-8 grid gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold">{c.kind}</dt>
        <dd>{c.kinds[shop.kind]}</dd>
        <dt className="font-semibold">{c.phone}</dt>
        <dd>
          {shop.phone ? `${showPhone(shop.phone)} · ` : ''}
          <span className={shop.phoneVerified ? '' : 'font-semibold'}>{shop.phoneVerified ? c.verified : c.notVerified}</span>
        </dd>
        {shop.area ? (
          <>
            <dt className="font-semibold">{c.area}</dt>
            <dd>{shop.area}</dd>
          </>
        ) : null}
        <dt className="font-semibold">{c.label}</dt>
        <dd>
          <span className="font-mono text-xl">{shop.labelCode}</span>
          <span className="block text-base">{c.labelHint}</span>
        </dd>
        {shop.billedThrough ? (
          <>
            <dt className="font-semibold">{c.billedThrough}</dt>
            <dd>
              <Link href={`/customers/${shop.billedThrough.id}`} className="underline underline-offset-4">{shop.billedThrough.name}</Link>
            </dd>
          </>
        ) : null}
        <dt className="font-semibold">{c.emptiesOwed}</dt>
        <dd>{shop.emptiesOwed}</dd>
      </dl>

      {shop.phoneVerified ? null : (
        <section aria-labelledby="verify" className="mb-8 max-w-xl rounded-md border-2 border-current p-4">
          <h2 id="verify" className="mb-2 text-2xl font-bold">{c.verifyTitle}</h2>
          <p className="mb-4">{c.verifyIntro}</p>
          <ActionForm action={verifyPhoneAction.bind(null, shop.id)} label={c.verify} working={c.verifying}>
            <Field name="code" label={c.code} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" />
          </ActionForm>
          <div className="mt-4 flex flex-wrap items-start gap-4">
            <ActionForm action={resendCheckAction.bind(null, shop.id)} label={c.resend} working={c.resending} secondary />
            <Link href="/customers/messages" className="inline-flex min-h-11 items-center underline underline-offset-4">{c.messages}</Link>
          </div>
        </section>
      )}
    </AppFrame>
  );
}
