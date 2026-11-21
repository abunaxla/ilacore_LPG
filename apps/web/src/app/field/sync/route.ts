import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { getFieldToken } from '@/lib/field-session';

/**
 * Sends one item from the handheld's outbox (src/lib/field-outbox.ts) to the API with the handheld session.
 * Only the two things that may be done without signal pass: starting a handover and scanning. The reply's status
 * is passed on, so the outbox can tell "try again later" (5xx, 401) from "refused" (4xx).
 */
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cheap "can the server be reached?" check for the handheld (src/lib/field-outbox.ts). */
export function HEAD() {
  return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  // A JSON body cannot be sent cross-site without a preflight; the cookies are SameSite=Strict as well.
  if (!req.headers.get('content-type')?.startsWith('application/json')) return NextResponse.json({ error: 'bad_request' }, { status: 415 });
  const token = await getFieldToken();
  if (!token) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  const op = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!op || typeof op.handoverId !== 'string' || !uuid.test(op.handoverId)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  let reply;
  if (op.kind === 'start' && typeof op.tripId === 'string' && uuid.test(op.tripId) && typeof op.customerId === 'string' && uuid.test(op.customerId)) {
    reply = await api(`/trips/${op.tripId}/handovers`, { method: 'POST', token, body: { customerId: op.customerId, id: op.handoverId } });
  } else if (op.kind === 'scan' && (op.direction === 'out' || op.direction === 'in') && Array.isArray(op.epcs) && op.epcs.every((e) => typeof e === 'string')) {
    reply = await api(`/handovers/${op.handoverId}/${op.direction}`, { method: 'POST', token, body: { epcs: op.epcs } });
  } else {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }
  return NextResponse.json(reply.data, { status: reply.status });
}
