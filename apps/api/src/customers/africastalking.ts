/**
 * Africa's Talking SMS client (https://developers.africastalking.com/docs/sms/sending).
 *
 * Retries only what may succeed a moment later (no connection, a timeout, a 5xx, a gateway error), and resends the
 * same text each time, so a retry after a slow "yes" at worst delivers the same code twice. Refusals that will not
 * change (a bad number, no balance, the number blocked us) are not retried.
 */

export interface AtConfig {
  username: string;
  apiKey: string;
  /** Registered sender ID or short code. Without one, Africa's Talking uses its shared sender. */
  from?: string | undefined;
}

export type AtOutcome =
  | { ok: true; messageId: string }
  /** `retryable` false: trying again will not help. `badNumber`: the number itself is refused (not our account). */
  | { ok: false; retryable: boolean; reason: string; badNumber?: boolean };

type Fetch = typeof globalThis.fetch;

const ACCEPTED = new Set([100, 101, 102]); // Processed, Sent, Queued
const TEMPORARY = new Set([500, 501, 502]); // InternalServerError, GatewayError, RejectedByGateway
// InvalidPhoneNumber, UnsupportedNumberType, UserInBlacklist, CouldNotRoute, DoNotDisturbRejection
const BAD_NUMBER = new Set([403, 404, 406, 407, 409]);

export class AfricasTalkingSms {
  private readonly url: string;

  constructor(
    private readonly config: AtConfig,
    private readonly opts: { fetch?: Fetch; attempts?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    // Africa's Talking's own convention: the username "sandbox" means the sandbox.
    const host = config.username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    this.url = `https://${host}/version1/messaging`;
  }

  async send(to: string, message: string): Promise<AtOutcome> {
    const attempts = this.opts.attempts ?? 3;
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let last: AtOutcome = { ok: false, retryable: true, reason: 'not_tried' };
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(500 * 2 ** (i - 1));
      last = await this.once(to, message);
      if (last.ok || !last.retryable) return last;
    }
    return last;
  }

  private async once(to: string, message: string): Promise<AtOutcome> {
    const form = new URLSearchParams({ username: this.config.username, to, message });
    if (this.config.from) form.set('from', this.config.from);
    let res: Response;
    try {
      res = await (this.opts.fetch ?? globalThis.fetch)(this.url, {
        method: 'POST',
        headers: { apiKey: this.config.apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      });
    } catch (e) {
      return { ok: false, retryable: true, reason: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'no_connection' };
    }
    if (res.status === 429 || res.status >= 500) return { ok: false, retryable: true, reason: `http_${res.status}` };
    // 401: wrong username or key. Other 4xx: a request we built wrongly. Neither is fixed by trying again.
    if (!res.ok) return { ok: false, retryable: false, reason: `http_${res.status}` };
    let body: { SMSMessageData?: { Message?: string; Recipients?: { statusCode?: number; status?: string; messageId?: string }[] } };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      return { ok: false, retryable: true, reason: 'bad_response' };
    }
    const r = body.SMSMessageData?.Recipients?.[0];
    if (!r) return { ok: false, retryable: false, reason: body.SMSMessageData?.Message || 'no_recipient' };
    if (r.statusCode !== undefined && ACCEPTED.has(r.statusCode)) return { ok: true, messageId: r.messageId ?? '' };
    const code = r.statusCode ?? 0;
    return { ok: false, retryable: TEMPORARY.has(code), badNumber: BAD_NUMBER.has(code), reason: r.status || `status_${code}` };
  }
}

// The GSM 03.38 alphabet (basic set and extension). Anything else turns the whole SMS into UCS-2: 70 characters a
// part instead of 160, so more parts for the same text, each billed.
const GSM = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€',
);
const LOOKALIKES: Record<string, string> = {
  '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"',
  '–': '-', '—': '-', '−': '-', '…': '...', ' ': ' ', '\t': ' ',
};

/** Keeps a message in the GSM alphabet: typographic quotes and dashes become plain ones, accents are dropped. */
export function toGsm(text: string): string {
  let out = '';
  for (const ch of text) {
    if (GSM.has(ch)) out += ch;
    else if (LOOKALIKES[ch]) out += LOOKALIKES[ch];
    else {
      const plain = ch.normalize('NFD').replace(/\p{M}/gu, '');
      out += plain && [...plain].every((p) => GSM.has(p)) ? plain : '?';
    }
  }
  return out;
}
