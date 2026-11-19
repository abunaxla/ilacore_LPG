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

export interface MfaSetupState extends FormState {
  phase: 'start' | 'scan' | 'codes';
  secret?: string;
  qr?: string;
  recoveryCodes?: string[];
}

/** One action for the whole set-up: "start" creates the secret and QR code, "confirm" checks the first code. */
export async function mfaSetupAction(prev: MfaSetupState, fd: FormData): Promise<MfaSetupState> {
  const token = await requireToken();
  if (fd.get('step') === 'start') {
    const reply = await api<{ secret: string; uri: string }>('/auth/mfa/setup', { method: 'POST', token });
    if (!reply.ok) return { phase: 'start', error: reply.error };
    const qr = await QRCode.toDataURL(reply.data.uri, { margin: 2, width: 240, errorCorrectionLevel: 'M' });
    return { phase: 'scan', secret: reply.data.secret, qr };
  }
  const reply = await api<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
    method: 'POST',
    body: { code: text(fd, 'code').replace(/\s/g, '') },
    token,
  });
  if (!reply.ok) return { ...prev, error: reply.error };
  return { phase: 'codes', recoveryCodes: reply.data.recoveryCodes };
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