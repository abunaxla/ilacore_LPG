/**
 * The common reader interface. The simulator implements it now; the vendor adapter for the real UHF
 * reader will implement the same thing, so nothing above it changes when the hardware arrives.
 */
export interface TagRead {
  /** The tag number as the reader reports it (normalised later by the API). */
  readonly epc: string;
  /** Signal strength in dBm (negative; closer to 0 is stronger). Null if the reader doesn't report it. */
  readonly rssi: number | null;
  readonly antenna: number | null;
  readonly readAt: Date;
}

export type ReadListener = (reads: readonly TagRead[]) => void;

export interface ReaderAdapter {
  /** A human name for logs ("Simulated reader", "Zebra FX9600 at gate 1"...). */
  readonly name: string;
  /** Starts reading. Reads arrive in bursts through the listeners until stop(). */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Subscribes to read bursts. Returns an unsubscribe function. */
  onReads(listener: ReadListener): () => void;
}
