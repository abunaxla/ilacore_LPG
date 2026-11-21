import Link from 'next/link';
import { Suspense } from 'react';
import { AppFrame } from '@/components/app-frame';
import { Loading } from '@/components/page-shell';
import { getMessages } from '@/i18n';
import { hasAny, requireMe } from '@/lib/auth';
import { load } from '../../admin/data';
import type { CustomerSummary } from '../data';
import { AddShopForm } from './add-shop-form';

export default function NewCustomerPage() {
  return (
    <Suspense fallback={<Loading />}>
      <NewCustomer />
    </Suspense>
  );
}

async function NewCustomer() {
  const me = await requireMe();
  const c = getMessages().customers;
  if (!hasAny(me, ['customer.manage'])) {
    return <AppFrame me={me} title={c.add}><p>{c.noAccess}</p></AppFrame>;
  }
  const wholesalers = await load<CustomerSummary[]>('/customers?kind=wholesaler', []);
  return (
    <AppFrame me={me} title={c.add}>
      <p className="mb-6">
        <Link href="/customers" className="underline underline-offset-4">{c.back}</Link>
      </p>
      <AddShopForm wholesalers={wholesalers.map((w) => ({ id: w.id, name: w.name }))} />
    </AppFrame>
  );
}
