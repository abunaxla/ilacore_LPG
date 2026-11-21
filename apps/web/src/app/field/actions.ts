'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import {
  clearDeviceCredential,
  clearFieldToken,
  getDeviceCredential,
  getFieldToken,
  setDeviceCredential,
  setFieldToken,
} from '@/lib/field-session';

/**
 * Handheld actions for drivers. Each forwards to the API with the handheld session; the API decides everything
 * (the driver's own trip, the balance, separation of duties). Nothing secret is kept in form state.
 */
const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const enc = encodeURIComponent;

async function send<T = Record<string, unknown>>(path: string, body?: unknown) {
  const token = await getFieldToken();
  if (!token) redirect('/field/sign-in');
  const reply = await api<T>(path, { method: 'POST', body, token });
  if (reply.status === 401) redirect('/field/sign-in');
  return reply;
}

/** For actions whose result is the page itself: refresh it, or say what went wrong. */
async function simple(path: string, body?: unknown, message?: string): Promise<FormState> {
  const reply = await send(path, body);
  if (!reply.ok) return { error: reply.error };
  refresh();
  return message ? { message } : {};
}

export async function pairAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const credential = text(fd, 'credential');
  // tenant.device.secret: checked properly by the API at sign-in; this only catches a bad paste.
  if (!/^[0-9a-f-]{36}\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}$/.test(credential)) return { error: 'invalid_device' };
  await setDeviceCredential(credential);
  await clearFieldToken();
  redirect('/field/sign-in');
}

export async function unpairAction(): Promise<void> {
  await clearFieldToken();
  await clearDeviceCredential();
  redirect('/field/pair');
}

export async function fieldSignInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const device = await getDeviceCredential();
  if (!device) redirect('/field/pair');
  // The PIN is sent exactly as typed.
  const reply = await api<{ token: string; expiresAt: string }>('/auth/device/sign-in', {
    method: 'POST',
    device,
    body: { phone: text(fd, 'phone'), pin: String(fd.get('pin') ?? '') },
  });
  if (!reply.ok) return { error: reply.error };
  await setFieldToken(reply.data.token, reply.data.expiresAt);
  redirect('/field');
}

export async function fieldSignOutAction(): Promise<void> {
  const token = await getFieldToken();
  if (token) await api('/auth/sign-out', { method: 'POST', token });
  await clearFieldToken();
  redirect('/field/sign-in');
}

export async function signLoadAction(tripId: string): Promise<FormState> {
  return simple(`/trips/${enc(tripId)}/sign`);
}

export async function startHandoverAction(tripId: string, customerId: string): Promise<FormState> {
  const reply = await send<{ id: string }>(`/trips/${enc(tripId)}/handovers`, { customerId });
  if (!reply.ok) return { error: reply.error };
  redirect(`/field/handovers/${enc(reply.data.id)}`);
}

export interface ScanState extends FormState {
  /** Tags added since this screen opened. */
  added?: number;
  /** Everything that was not simply added, newest first (the last 20), so no warning is overwritten. */
  outcomes?: { epc: string; result: string; reason?: string }[];
}

export async function scanAction(handoverId: string, prev: ScanState, fd: FormData): Promise<ScanState> {
  const direction = text(fd, 'direction') === 'in' ? 'in' : 'out';
  const epcs = [...new Set(text(fd, 'tags').toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  const kept = { ...(prev.added ? { added: prev.added } : {}), ...(prev.outcomes ? { outcomes: prev.outcomes } : {}) };
  if (epcs.length === 0) return kept;
  const reply = await send<{ outcomes: NonNullable<ScanState['outcomes']> }>(`/handovers/${enc(handoverId)}/${direction}`, { epcs });
  if (!reply.ok) return { ...kept, error: reply.error };
  refresh();
  const outcomes = reply.data.outcomes ?? [];
  const added = outcomes.filter((o) => o.result === 'added').length;
  return {
    added: (prev.added ?? 0) + added,
    outcomes: [...outcomes.filter((o) => o.result !== 'added').reverse(), ...(prev.outcomes ?? [])].slice(0, 20),
  };
}

export async function removeLineAction(handoverId: string, itemId: string): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/lines/${enc(itemId)}/remove`);
}

export async function setBoughtAction(handoverId: string, itemId: string, sold: boolean): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/lines/${enc(itemId)}/sold`, { sold });
}

export async function askOwedAction(handoverId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/owed`, { dueOn: text(fd, 'dueOn') });
}

export interface SendCodeState extends FormState {
  shortfall?: number;
}

export async function sendCodeAction(handoverId: string, _prev: SendCodeState, fd: FormData): Promise<SendCodeState> {
  const reply = await send(`/handovers/${enc(handoverId)}/request-confirmation`, { acceptShortfall: fd.get('acceptShortfall') === 'on' });
  if (!reply.ok) {
    const shortfall = reply.data['shortfall'];
    return { error: reply.error, ...(typeof shortfall === 'number' ? { shortfall } : {}) };
  }
  refresh();
  return {};
}

export async function confirmCodeAction(handoverId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/confirm`, { code: text(fd, 'code').replace(/\s/g, '') });
}

export async function resendCodeAction(handoverId: string): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/resend-code`, undefined, getMessages().field.resent);
}

export async function disputeAction(handoverId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/dispute`, { note: text(fd, 'note') });
}

export async function cancelHandoverAction(handoverId: string): Promise<FormState> {
  return simple(`/handovers/${enc(handoverId)}/cancel`);
}
