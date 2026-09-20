/**
 * Local, in-process simulator for the ShadowStamp contract.
 *
 * Runs the compiled circuits against the Compact runtime without a node,
 * indexer, or proof server — the same JS the SDK executes before proving.
 * This lets tests exercise circuit logic, ledger transitions, and the
 * public/private boundary in milliseconds.
 */
import {
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
  type CircuitContext,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  ledger,
  type Ledger,
  type Witnesses,
} from '../contracts/managed/shadowstamp/contract/index.js';

/** Private state kept on the attendee's machine. Never sent on-chain. */
export type PrivateState = {
  readonly secret: Uint8Array;
};

/**
 * Witness implementations. `attendeeSecret` is the only witness in the
 * contract: it hands the attendee's secret into the circuit from private state.
 */
export const witnesses: Witnesses<PrivateState> = {
  attendeeSecret: ({ privateState }) => [privateState, privateState.secret],
};

// Any 32-byte hex string works as a coin public key for local simulation.
const DUMMY_COIN_PUBLIC_KEY = '0'.repeat(64);

export class ShadowStampSimulator {
  private readonly contract = new Contract<PrivateState>(witnesses);
  private readonly address = sampleContractAddress();
  private ctx!: CircuitContext<PrivateState>;

  private constructor() {}

  /** Deploy a fresh contract instance for `eventId`, acting as `secret`'s owner. */
  static async deploy(eventId: Uint8Array, secret: Uint8Array): Promise<ShadowStampSimulator> {
    const sim = new ShadowStampSimulator();
    const { currentContractState, currentPrivateState, currentZswapLocalState } =
      await sim.contract.initialState(createConstructorContext({ secret }, DUMMY_COIN_PUBLIC_KEY), eventId);
    sim.ctx = createCircuitContext(sim.address, currentZswapLocalState, currentContractState, currentPrivateState);
    return sim;
  }

  /** Public ledger view — exactly what anyone can read from the chain. */
  ledger(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }

  /** The private state as held locally by the current attendee. */
  privateState(): PrivateState {
    return this.ctx.currentPrivateState;
  }

  /** Serialised on-chain state, used to assert that secrets never leak. */
  serializedLedger(): string {
    return this.ctx.currentQueryContext.state.toString();
  }

  /** Impersonate a different attendee by swapping the private secret. */
  as(secret: Uint8Array): this {
    this.ctx = { ...this.ctx, currentPrivateState: { secret } };
    return this;
  }

  async stamp(): Promise<void> {
    const res = await this.contract.impureCircuits.stamp(this.ctx);
    this.ctx = res.context;
  }

  async hasStamped(nullifier: Uint8Array): Promise<boolean> {
    const res = await this.contract.impureCircuits.hasStamped(this.ctx, nullifier);
    this.ctx = res.context;
    return res.result;
  }
}

/** Helper: deterministic 32-byte value from a label (for readable tests). */
export function bytes32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  const enc = new TextEncoder().encode(label);
  out.set(enc.subarray(0, 32));
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hex with trailing zero bytes removed (matches the runtime's string form). */
export function trimHex(b: Uint8Array): string {
  return toHex(b).replace(/(00)+$/, '');
}
