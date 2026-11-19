'use server';

import { refresh } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/components/form-bits';
import { getMessages } from '@/i18n';
import { api } from '@/lib/api';
import { getToken } from '@/lib/session';
import type { CylinderSettings } from './data';

/**
 * Cylinder actions. Each forwards to the API with the caller's session; the API checks the permission
 * at the location, validates everything and records the event. Nothing secret is kept in form state.
 */
const text = (fd: FormData, name: string) => String(fd.get(name) ?? '').trim();
const optional = (fd: FormData, name: string) => text(fd, name) || undefined;

async function token(): Promise<string> {
  const t = await getToken();
  if (!t) redirect('/sign-in');
  return t;
}

async function send(path: string, body?: unknown, method: 'POST' | 'PUT' = 'POST') {
  const reply = await api<Record<string, unknown>>(path, { method, body, token: await token() });
  if (reply.status === 401) redirect('/sign-in');
  return reply;
}

export interface RowProblem {
  row: number;
  fields: string[];
  reason?: string;
}

export interface RegisterState extends FormState {
  problem?: RowProblem;
  createdId?: string;
  /** What was typed, so a refused form comes back filled in (none of it is secret). */
  values?: Record<string, string>;
  seq?: number;
}

const REGISTER_FIELDS = ['locationId', 'sizeId', 'epc', 'serial', 'manufacturer', 'manufacturedOn', 'tareKg', 'lastTestOn', 'nextTestDue', 'physicalState'];

export async function registerCylinderAction(prev: RegisterState, fd: FormData): Promise<RegisterState> {
  const values = Object.fromEntries(REGISTER_FIELDS.map((f) => [f, text(fd, f)]));
  const seq = (prev.seq ?? 0) + 1;
  const tare = optional(fd, 'tareKg');
  const reply = await send('/cylinders', {
    locationId: text(fd, 'locationId'),
    sizeId: text(fd, 'sizeId'),
    epc: text(fd, 'epc'),
    serial: optional(fd, 'serial'),
    manufacturer: optional(fd, 'manufacturer'),
    manufacturedOn: optional(fd, 'manufacturedOn'),
    tareKg: tare === undefined ? undefined : Number(tare.replace(',', '.')),
    lastTestOn: optional(fd, 'lastTestOn'),
    nextTestDue: optional(fd, 'nextTestDue'),
    physicalState: text(fd, 'physicalState') === 'full' ? 'full' : 'empty',
  });
  if (!reply.ok) {
    const rows = reply.data['rows'] as RowProblem[] | undefined;
    const fields = reply.data['fields'] as string[] | undefined;
    const problem = rows?.[0] ?? (fields ? { row: 0, fields } : undefined);
    return { error: reply.error, ...(problem ? { problem } : {}), values, seq };
  }
  refresh();
  // Keep the place, size and fill for the next one; clear the cylinder's own details.
  return {
    message: getMessages().registerCylinder.done,
    createdId: String(reply.data['id']),
    values: { locationId: values['locationId']!, sizeId: values['sizeId']!, physicalState: values['physicalState']! },
    seq,
  };
}

export interface ImportState extends FormState {
  /** Problems by spreadsheet row number (the header is row 1). */
  problems?: { line: number; messages: string[] }[];
  text?: string;
  locationId?: string;
  seq?: number;
}

const COLUMNS: Record<string, string[]> = {
  epc: ['tag', 'epc', 'tag number', 'rfid', 'rfid tag'],
  size: ['size', 'kg', 'size kg'],
  serial: ['serial', 'serial number', 'serial no', 'serial no.'],
  manufacturer: ['manufacturer', 'maker', 'make'],
  manufacturedOn: ['manufactured', 'manufactured on', 'date of manufacture', 'manufacture date', 'mfg'],
  tareKg: ['tare', 'tare kg', 'tare weight'],
  lastTestOn: ['last test', 'last tested', 'last test date', 'tested'],
  nextTestDue: ['next test', 'next test due', 'due', 'test due'],
  physicalState: ['state', 'fill'],
};

/** Accepts 2026-11-20 or 20/11/2026 (day first, as written in Kenya). Anything else goes to the API as typed. */
function toIsoDate(value: string): string {
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}` : value;
}

/** The nil UUID: well formed, so the API reads it, but never the id of a size. */
const NO_SIZE = '00000000-0000-0000-0000-000000000000';

const sizeKey = (s: string) => s.toLowerCase().replace(/\s+/g, '').replace(/kgs?$/, '');

export async function importCylindersAction(prev: ImportState, fd: FormData): Promise<ImportState> {
  const t = getMessages().importCylinders;
  const r = getMessages().registerCylinder;
  const raw = String(fd.get('rows') ?? '');
  const locationId = text(fd, 'locationId');
  const seq = (prev.seq ?? 0) + 1;
  const keep = { text: raw, locationId, seq };

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { error: 'invalid_request', problems: [{ line: 1, messages: [t.empty] }], ...keep };
  if (lines.length > 501) return { error: 'invalid_request', problems: [{ line: 1, messages: [t.tooMany] }], ...keep };
  const delimiter = lines[0]!.includes('\t') ? '\t' : lines[0]!.includes(';') ? ';' : ',';
  const split = (line: string) => line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());

  const header = split(lines[0]!).map((h) => h.toLowerCase().replace(/[()_]/g, ' ').replace(/\s+/g, ' ').trim());
  const columnOf: (string | null)[] = [];
  const unknown: string[] = [];
  for (const h of header) {
    const key = Object.entries(COLUMNS).find(([, names]) => names.includes(h))?.[0] ?? null;
    if (!key && h) unknown.push(t.unknownColumn(h));
    columnOf.push(key);
  }
  if (!columnOf.includes('epc') || !columnOf.includes('size')) return { error: 'invalid_request', problems: [{ line: 1, messages: [t.noHeader, ...unknown] }], ...keep };
  if (unknown.length > 0) return { error: 'invalid_request', problems: [{ line: 1, messages: unknown }], ...keep };

  const settings = await api<CylinderSettings>('/cylinder-settings', { token: await token() });
  const sizes = settings.ok ? settings.data.sizes.filter((s) => !s.retired) : [];
  const sizeId = (value: string) =>
    sizes.find((s) => sizeKey(s.name) === sizeKey(value) || String(s.nominalFillKg) === sizeKey(value))?.id;

  const problems: { line: number; messages: string[] }[] = [];
  const cylinders = lines.slice(1).map((line, i) => {
    const cells = split(line);
    const get = (key: string) => {
      const index = columnOf.indexOf(key);
      return index >= 0 ? (cells[index] ?? '') : '';
    };
    const size = get('size');
    const id = sizeId(size);
    if (!id) problems.push({ line: i + 2, messages: [t.unknownSize(size)] });
    const tare = get('tareKg');
    const state = get('physicalState').toLowerCase();
    return {
      // An unmatched size still goes to the API under an id no size can have, so the API checks every other
      // column too and the person sees all the problems in one go. The API always rejects it (unknown_size).
      sizeId: id ?? NO_SIZE,
      epc: get('epc'),
      serial: get('serial') || undefined,
      manufacturer: get('manufacturer') || undefined,
      manufacturedOn: get('manufacturedOn') ? toIsoDate(get('manufacturedOn')) : undefined,
      tareKg: tare ? Number(tare.replace(',', '.')) : undefined,
      lastTestOn: get('lastTestOn') ? toIsoDate(get('lastTestOn')) : undefined,
      nextTestDue: get('nextTestDue') ? toIsoDate(get('nextTestDue')) : undefined,
      physicalState: state === 'full' ? ('full' as const) : ('empty' as const),
    };
  });
  const reply = await send('/cylinders/import', { locationId, cylinders });
  if (!reply.ok || problems.length > 0) {
    const rows = reply.ok ? [] : ((reply.data['rows'] as RowProblem[] | undefined) ?? []);
    const byLine = new Map<number, string[]>(problems.map((p) => [p.line, p.messages]));
    for (const p of rows) {
      // The size message written here names what was typed; the API's own one would only repeat it.
      if (p.reason === 'unknown_size' && byLine.has(p.row + 2)) continue;
      const messages = p.reason
        ? [r.reasons[p.reason as keyof typeof r.reasons] ?? p.reason]
        : p.fields.map((f) => `${r.checkFields} ${r.fields[f as keyof typeof r.fields] ?? f}`);
      byLine.set(p.row + 2, [...(byLine.get(p.row + 2) ?? []), ...messages]);
    }
    const sorted = [...byLine].sort(([a], [b]) => a - b).map(([line, messages]) => ({ line, messages }));
    return { error: reply.ok ? 'invalid_rows' : reply.error, problems: sorted, ...keep };
  }
  refresh();
  return { message: t.done((reply.data['ids'] as string[]).length), text: '', locationId, seq };
}

export async function replaceTagAction(itemId: string, _prev: FormState, fd: FormData): Promise<FormState> {
  const reply = await send(`/cylinders/${itemId}/tag`, { epc: text(fd, 'epc'), reason: text(fd, 'reason') });
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().cylinder.replaced };
}

export async function addSizeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const kg = Number(text(fd, 'nominalFillKg').replace(',', '.'));
  const reply = await send('/cylinder-settings/sizes', { name: text(fd, 'name'), nominalFillKg: kg });
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().admin.saved };
}

export async function retireSizeAction(sizeId: string): Promise<FormState> {
  const reply = await send(`/cylinder-settings/sizes/${sizeId}/retire`);
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().admin.saved };
}

export async function setRetestIntervalAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const raw = text(fd, 'months');
  const months = raw === '' ? null : Number(raw);
  if (months !== null && !Number.isInteger(months)) return { error: 'invalid_request' };
  const reply = await send('/cylinder-settings/retest-interval', { months }, 'PUT');
  if (!reply.ok) return { error: reply.error };
  refresh();
  return { message: getMessages().admin.saved };
}
