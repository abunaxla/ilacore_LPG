'use server';

import { redirect } from 'next/navigation';
import QRCode from 'qrcode';
import type { FormState } from '@/components/form-bits';
import { api } from '@/lib/api';
import { stepPath, type NextStep } from '@/lib/auth';
import { clearToken, getToken, setToken } from '@/lib/session';

const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();

function tokenFrom(setCookies: string[]): string | undefined {
  const cookie = setCookies.find((c) => c.startsWith('lpg_session='));
  return cookie ? decodeURIComponent(cookie.slice('lpg_session='.length).split(';')[0]!) : undefined;
}

async function requireToken(): Promise<string> {
  const token = await getToken();
  if (!token) redirect('/sign-in');
  return token;
}

export async function signInAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const reply = await api<{ next: NextStep; expiresAt: string }>('/auth/sign-in', {
    method: 'POST',
    // Passwords are sent exactly as typed: never trimmed.
    body: { organisation: text(fd, 'organisation'), phone: text(fd, 'phone'), password: String(fd.get('password') ?? '') },
  });
  if (!reply.ok) return { error: reply.error };
  const token = tokenFrom(reply.setCookies);
  if (!token) return { error: 'unknown' };
  await setToken(token, reply.data.expiresAt);
  redirect(stepPath(reply.data.next));
}

export async function verifyMfaAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = await requireToken();
  const recoveryCode = text(fd, 'recoveryCode');
  const body = recoveryCode ? { recoveryCode } : { code: text(fd, 'code').replace(/\s/g, '') };
  const reply = await api('/auth/mfa/verify', { method: 'POST', body, token });
  if (!reply.ok) return { error: reply.error };
  redirect('/');
}

export interface MfaStartState extends FormState {
  secret?: string;
  qr?: string;
}

export interface MfaConfirmState extends FormState {
  recoveryCodes?: string[];
}

/*
 * Set-up is two separate actions on purpose. React sends an action's previous state back to the server with
 * each submission (and Next logs action arguments in development). If one action held the secret in its state,
 * confirming would send the secret back. Here the secret only ever travels server -> browser, once.
 */

/** Creates the secret and its QR code. */
export async function startMfaSetupAction(_prev: MfaStartState): Promise<MfaStartState> {
  const token = await requireToken();
  const reply = await api<{ secret: string; uri: string }>('/auth/mfa/setup', { method: 'POST', token });
  if (!reply.ok) return { error: reply.error };
  const qr = await QRCode.toDataURL(reply.data.uri, { margin: 2, width: 240, errorCorrectionLevel: 'M' });
  return { secret: reply.data.secret, qr };
}

/** Checks the first code from the app and returns the recovery codes. */
export async function confirmMfaSetupAction(_prev: MfaConfirmState, fd: FormData): Promise<MfaConfirmState> {
  const token = await requireToken();
  const reply = await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
    method: 'POST',
    body: { code: text(fd, 'code').replace(/\s/g, '') },
    token,
  });
  if (!reply.ok) return { error: reply.error };
  return { recoveryCodes: reply.data.recoveryCodes };
}

export async function changePasswordAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = await requireToken();
  const reply = await api('/auth/password', {
    method: 'POST',
    body: { current: String(fd.get('current') ?? ''), next: String(fd.get('next') ?? '') },
    token,
  });
  if (!reply.ok) return { error: reply.error };
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  const token = await getToken();
  if (token) await api('/auth/sign-out', { method: 'POST', token });
  await clearToken();
  redirect('/sign-in');
}