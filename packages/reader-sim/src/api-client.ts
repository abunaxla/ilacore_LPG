/**
 * Talks to the ILACORE API exactly as a real handheld or fixed reader will: it signs in with its own
 * device credential (revocable by an administrator) plus the operator's phone and PIN, opens a scan
 * session, uploads reads in batches, and closes the session.
 */
import { randomUUID } from 'node:crypto';
import type { TagRead } from './adapter.js';

export const BATCH_SIZE = 500;

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

export interface DeviceSignIn {
  /** The credential shown once when the device was registered. Keep it out of logs and shell history. */
  readonly credential: string;
  readonly phone: string;
  readonly pin: string;
}

export class ReaderApiClient {
  private token: string | undefined;

  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async signIn(input: DeviceSignIn): Promise<void> {
    const reply = await this.call<{ token: string }>('POST', '/auth/device/sign-in', { phone: input.phone, pin: input.pin }, `Device ${input.credential}`);
    this.token = reply.token;
  }

  async openSession(input: { purpose: string; locationId: string; note?: string }): Promise<string> {
    const reply = await this.call<{ id: string }>('POST', '/scan-sessions', input);
    return reply.id;
  }

  /**
   * Uploads reads in batches of up to 500. Each batch has its own id, and a failed upload is retried
   * with the same id, so the API stores it once however many times it arrives.
   */
  async sendReads(sessionId: string, reads: readonly TagRead[], options: { retries?: number } = {}): Promise<{ batches: number; accepted: number }> {
    let accepted = 0;
    let batches = 0;
    for (let i = 0; i < reads.length; i += BATCH_SIZE) {
      const batchId = randomUUID();
      const body = {
        batchId,
        reads: reads.slice(i, i + BATCH_SIZE).map((r) => ({
          epc: r.epc,
          rssi: r.rssi,
          antenna: r.antenna,
          readAt: r.readAt.toISOString(),
        })),
      };
      const reply = await this.withRetry(
        () => this.call<{ accepted: number }>('POST', `/scan-sessions/${sessionId}/reads`, body),
        options.retries ?? 3,
      );
      accepted += reply.accepted;
      batches += 1;
    }
    return { batches, accepted };
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.call('POST', `/scan-sessions/${sessionId}/close`);
  }

  async signOut(): Promise<void> {
    if (this.token) await this.call('POST', '/auth/sign-out').catch(() => undefined);
    this.token = undefined;
  }

  private async withRetry<T>(work: () => Promise<T>, retries: number): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await work();
      } catch (error) {
        // Only network failures and server errors are worth retrying; a 4xx will fail again.
        const retryable = !(error instanceof ApiError) || error.status >= 500;
        if (!retryable || attempt >= retries) throw error;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  }

  private async call<T = unknown>(method: string, path: string, body?: unknown, authorization?: string): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    const auth = authorization ?? (this.token ? `Bearer ${this.token}` : undefined);
    if (auth) headers['authorization'] = auth;
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!res.ok) {
      throw new ApiError(res.status, typeof data.error === 'string' ? data.error : undefined, typeof data.message === 'string' ? data.message : `HTTP ${res.status}`);
    }
    return data as T;
  }
}
