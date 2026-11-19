'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';

/**
 * Administration actions. Each one only forwards to the API with the caller's session; the API checks
 * the permission, validates the input and writes the audit entry.
 */
const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const optional = (fd: FormData, name: string) => text(fd, name) || undefined;

async function send(path: string, body?: unknown): Promise<FormState & { data?: Record<string, unknown> }> {
  const token = await getToken();
  if (!token) redirect('/sign-in');
  const reply = await api(path, { method: 'POST', body, token });
  if (reply.status === 401) redirect('/sign-in');
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().admin.saved, data: reply.data };
}

export async function createUserAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const r = await send('/users', {
    phone: text(fd, 'phone'),
    displayName: text(fd, 'displayName'),
    password: fd.get('password') ? String(fd.get('password')) : undefined,
    pin: optional(fd, 'pin'),
  });
  return r.error ? r : { message: getMessages().users.created };
}

export async function grantRoleAction(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return send(`/users/${userId}/roles`, { role: text(fd, 'role'), locationId: optional(fd, 'locationId') });
}

export async function revokeRoleAction(userId: string, assignmentId: string): Promise<FormState> {
  return send(`/users/${userId}/roles/${assignmentId}/revoke`);
}

export async function setPinAction(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return send(`/users/${userId}/pin`, { pin: text(fd, 'pin') });
}

export async function resetPasswordAction(userId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  return send(`/users/${userId}/password`, { password: String(fd.get('password') ?? '') });
}

export async function resetMfaAction(userId: string): Promise<FormState> {
  return send(`/users/${userId}/mfa/reset`);
}

export async function setStatusAction(userId: string, status: 'active' | 'disabled'): Promise<FormState> {
  return send(`/users/${userId}/status`, { status });
}

export interface DeviceFormState extends FormState {
  credential?: string;
}

export async function registerDeviceAction(_prev: DeviceFormState, fd: FormData): Promise<DeviceFormState> {
  const r = await send('/devices', { name: text(fd, 'name'), kind: text(fd, 'kind'), locationId: optional(fd, 'locationId') });
  if (r.error) return r;
  return { message: r.message, credential: String(r.data?.['credential'] ?? '') };
}

export async function revokeDeviceAction(deviceId: string): Promise<FormState> {
  return send(`/devices/${deviceId}/revoke`);
}

export async function createLocationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return send('/locations', { name: text(fd, 'name'), kind: text(fd, 'kind') });
}