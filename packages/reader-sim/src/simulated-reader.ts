import type { ReaderAdapter, ReadListener, TagRead } from './adapter.js';
import { runScenario, type Scenario } from './scenario.js';

/**
 * A reader that plays a scenario in real time: reads arrive in bursts, as a real reader's would,
 * spread over the scenario's duration. `speed` > 1 plays it faster (handy in demos).
 */
export class SimulatedReader implements ReaderAdapter {
  readonly name: string;
  private readonly listeners = new Set<ReadListener>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly scenario: Scenario,
    private readonly options: { burstMs?: number; speed?: number; name?: string } = {},
  ) {
    this.name = options.name ?? 'Simulated reader';
  }

  onReads(listener: ReadListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.timer) return;
    const startedAt = new Date();
    const pending: TagRead[] = runScenario(this.scenario, startedAt).reads;
    const speed = this.options.speed ?? 1;
    const burstMs = this.options.burstMs ?? 250;
    this.timer = setInterval(() => {
      const virtualNow = startedAt.getTime() + (Date.now() - startedAt.getTime()) * speed;
      let n = 0;
      while (n < pending.length && pending[n]!.readAt.getTime() <= virtualNow) n += 1;
      if (n > 0) this.emit(pending.splice(0, n));
      if (pending.length === 0) void this.stop();
    }, burstMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private emit(reads: TagRead[]): void {
    for (const l of this.listeners) l(reads);
  }
}
