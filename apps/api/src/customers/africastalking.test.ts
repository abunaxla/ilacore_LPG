import { describe, expect, it } from 'vitest';
import { AfricasTalkingSms, toGsm } from './africastalking.js';

const accepted = { SMSMessageData: { Message: 'Sent to 1/1', Recipients: [{ statusCode: 101, status: 'Success', messageId: 'ATXid_1' }] } };
const recipient = (statusCode: number, status: string) => ({ SMSMessageData: { Message: 'Sent to 0/1', Recipients: [{ statusCode, status }] } });

/** A fake fetch that answers from a script and records what was asked. */
function fake(...answers: (object | number | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a instanceof Error) throw a;
    if (typeof a === 'number') return new Response('{}', { status: a });
    return new Response(JSON.stringify(a), { status: 201, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}
const noWait = async () => undefined;

describe("Africa's Talking client", () => {
  it('posts the message to the live endpoint with the key in the header', async () => {
    const f = fake(accepted);
    const at = new AfricasTalkingSms({ username: 'ilacore', apiKey: 'k', from: 'ILACORE' }, { fetch: f.fetch, sleep: noWait });
    expect(await at.send('+254711000001', 'hi')).toEqual({ ok: true, messageId: 'ATXid_1' });
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe('https://api.africastalking.com/version1/messaging');
    expect((f.calls[0]!.init.headers as Record<string, string>).apiKey).toBe('k');
    const form = f.calls[0]!.init.body as URLSearchParams;
    expect(Object.fromEntries(form)).toEqual({ username: 'ilacore', to: '+254711000001', message: 'hi', from: 'ILACORE' });
  });

  it('uses the sandbox for the "sandbox" username and leaves out an unset sender', async () => {
    const f = fake(accepted);
    await new AfricasTalkingSms({ username: 'sandbox', apiKey: 'k' }, { fetch: f.fetch }).send('+254711000001', 'hi');
    expect(f.calls[0]!.url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect((f.calls[0]!.init.body as URLSearchParams).has('from')).toBe(false);
  });

  it('retries lost connections, server errors and gateway errors, then succeeds', async () => {
    const f = fake(new TypeError('fetch failed'), 503, accepted);
    const at = new AfricasTalkingSms({ username: 'u', apiKey: 'k' }, { fetch: f.fetch, sleep: noWait });
    expect((await at.send('+254711000001', 'hi')).ok).toBe(true);
    expect(f.calls).toHaveLength(3);
  });

  it('gives up after the last attempt and says it may work later', async () => {
    const f = fake(recipient(501, 'GatewayError'), recipient(501, 'GatewayError'), recipient(501, 'GatewayError'), accepted);
    const at = new AfricasTalkingSms({ username: 'u', apiKey: 'k' }, { fetch: f.fetch, sleep: noWait });
    expect(await at.send('+254711000001', 'hi')).toMatchObject({ ok: false, retryable: true, reason: 'GatewayError' });
    expect(f.calls).toHaveLength(3);
  });

  it('does not retry a refused number, and says the number is the problem', async () => {
    const f = fake(recipient(403, 'InvalidPhoneNumber'), accepted);
    const at = new AfricasTalkingSms({ username: 'u', apiKey: 'k' }, { fetch: f.fetch, sleep: noWait });
    expect(await at.send('+254711000001', 'hi')).toEqual({ ok: false, retryable: false, badNumber: true, reason: 'InvalidPhoneNumber' });
    expect(f.calls).toHaveLength(1);
  });

  it('does not retry account problems (wrong key, no balance)', async () => {
    const wrongKey = fake(401, accepted);
    expect(await new AfricasTalkingSms({ username: 'u', apiKey: 'bad' }, { fetch: wrongKey.fetch, sleep: noWait }).send('+254711000001', 'hi'))
      .toEqual({ ok: false, retryable: false, reason: 'http_401' });
    expect(wrongKey.calls).toHaveLength(1);
    const broke = fake(recipient(405, 'InsufficientBalance'));
    expect(await new AfricasTalkingSms({ username: 'u', apiKey: 'k' }, { fetch: broke.fetch, sleep: noWait }).send('+254711000001', 'hi'))
      .toMatchObject({ ok: false, retryable: false, badNumber: false, reason: 'InsufficientBalance' });
  });
});

describe('toGsm', () => {
  it('keeps plain text as it is', () => {
    const s = "ILACORE: Demo Driver (KDA 123A) at Mama Njeri's. 2x13kg FULL given. Ref 4598. If correct, give the driver code 123456.";
    expect(toGsm(s)).toBe(s);
  });

  it('swaps typographic punctuation and drops accents, so the SMS stays at 160 characters a part', () => {
    expect(toGsm('Wanjirũ’s shop — “Kayole” …')).toBe('Wanjiru\'s shop - "Kayole" ...');
  });

  it('replaces anything with no GSM form', () => {
    expect(toGsm('Gas 🔥 ok')).toBe('Gas ? ok');
  });
});
