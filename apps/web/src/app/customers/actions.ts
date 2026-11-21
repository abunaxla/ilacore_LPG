'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';

/** Shop actions. The API checks customer.manage, validates and audits; nothing secret is kept in form state. */
const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();

async function send(path: string, body?: unknown) {
  const token = await getToken();
  if (!token) redirect('/sign-in');
  const reply = await api<Record<string, unknown>>(path, { method: 'POST', body, token });
  if (reply.status === 401) redirect('/sign-in');
  return reply;
}

export interface AddShopState extends FormState {
  fields?: string[];
  values?: Record<string, string>;
  seq?: number;
}

export async function addShopAction(prev: AddShopState, fd: FormData): Promise<AddShopState> {
  const values = Object.fromEntries(['kind', 'name', 'phone', 'area', 'billedThrough'].map((f) => [f, text(fd, f)]));
  const seq = (prev.seq ?? 0) + 1;
  const kind = values['kind'] === 'wholesaler' ? 'wholesaler' : 'retailer';
  const reply = await send('/customers', {
    kind,
    name: values['name'],
    phone: values['phone'],
    area: values['area'] || undefined,
    billedThrough: kind === 'retailer' && values['billedThrough'] ? values['billedThrough'] : undefined,
  });
  if (!reply.ok) {
    const fields = reply.data['fields'] as string[] | undefined;
    return { error: reply.error, ...(fields ? { fields } : {}), values, seq };
  }
  // Straight to the shop, where the number is checked.
  redirect(`/customers/${encodeURIComponent(String(reply.data['id']))}?added=1`);
}

export async function verifyPhoneAction(id: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const reply = await send(`/customers/${encodeURIComponent(id)}/phone-check/verify`, { code: text(fd, 'code') });
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().customers.verifiedDone };
}

export async function resendCheckAction(id: string): Promise<FormState> {
  const reply = await send(`/customers/${encodeURIComponent(id)}/phone-check`);
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().customers.resent };
}
