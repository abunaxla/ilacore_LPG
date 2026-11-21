import { NextResponse, type NextRequest } from 'next/server';
import { api } from '@/lib/api';
import { getFieldToken } from '@/lib/field-session';

/**
 * Shops for the handheld: `?q=` searches, no query lists them all (up to 200) for keeping on the handheld so the
 * driver can find a shop with no signal. Drivers never get shops' numbers (the API leaves them out).
 */
export async function GET(req: NextRequest) {
  const token = await getFieldToken();
  if (!token) return NextResponse.json({ error: 'signed_out' }, { status: 401 });
  const q = req.nextUrl.searchParams.get('q')?.trim();
  const reply = await api<{ id: string; name: string; area: string | null; labelCode: string; phoneVerified: boolean }[]>(
    q ? `/customers?search=${encodeURIComponent(q)}` : '/customers',
    { token },
  );
  if (!reply.ok) return NextResponse.json({ error: reply.error }, { status: reply.status });
  const shops = reply.data.map(({ id, name, area, labelCode, phoneVerified }) => ({ id, name, area, labelCode, phoneVerified }));
  return NextResponse.json(shops, { headers: { 'cache-control': 'no-store' } });
}
