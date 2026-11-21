'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';

/** Trip actions for supervisors on the web. The API checks the permission at the depot and separation of duties. */
async function send(path: string): Promise<FormState> {
  const token = await getToken();
  if (!token) redirect('/sign-in');
  const reply = await api(path, { method: 'POST', token });
  if (reply.status === 401) redirect('/sign-in');
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().admin.saved };
}

export async function approveLineAction(tripId: string, itemId: string): Promise<FormState> {
  return send(`/trips/${encodeURIComponent(tripId)}/lines/${encodeURIComponent(itemId)}/approve`);
}

export async function cancelTripAction(tripId: string): Promise<FormState> {
  return send(`/trips/${encodeURIComponent(tripId)}/cancel`);
}

export async function approveOwedAction(handoverId: string): Promise<FormState> {
  return send(`/handovers/${encodeURIComponent(handoverId)}/owed/approve`);
}
