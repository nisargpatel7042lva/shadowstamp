/**
 * In-process simulator for the ShadowBallot contract.
 *
 * Runs the compiled circuits against the Compact runtime with no node, indexer
 * or proof server — the same JS the SDK executes before proving — so the tests
 * exercise real circuit logic, ledger transitions and the public/private
 * boundary in milliseconds.
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
} from '../contracts/managed/shadowballot/contract/index.js';

/** Private state held on the voter's own device. Never sent anywhere. */
export type PrivateState = {
  readonly secret: Uint8Array;
};

export const witnesses: Witnesses<PrivateState> = {
  voterSecret: ({ privateState }) => [privateState, privateState.secret],
};

const DUMMY_COIN_PUBLIC_KEY = '0'.repeat(64);

export class ShadowBallotSimulator {
  private readonly contract = new Contract<PrivateState>(witnesses);
  private readonly address = sampleContractAddress();
  private ctx!: CircuitContext<PrivateState>;

  private constructor() {}

  /** Open a poll with `options` choices, acting as the holder of `secret`. */
  static async open(pollId: Uint8Array, options: number, secret: Uint8Array): Promise<ShadowBallotSimulator> {
    const sim = new ShadowBallotSimulator();
    const { currentContractState, currentPrivateState, currentZswapLocalState } =
      await sim.contract.initialState(
        createConstructorContext({ secret }, DUMMY_COIN_PUBLIC_KEY),
        pollId,
        BigInt(options),
      );
    sim.ctx = createCircuitContext(sim.address, currentZswapLocalState, currentContractState, currentPrivateState);
    return sim;
  }

  /** The public ledger — exactly what any observer can read from the chain. */
  ledger(): Ledger {
    return ledger(this.ctx.currentQueryContext.state);
  }

  privateState(): PrivateState {
    return this.ctx.currentPrivateState;
  }

  /** Serialised on-chain state, used to assert secrets never leak. */
  serializedLedger(): string {
    return this.ctx.currentQueryContext.state.toString();
  }

  /** Switch to a different voter by swapping the private secret. */
  as(secret: Uint8Array): this {
    this.ctx = { ...this.ctx, currentPrivateState: { secret } };
    return this;
  }

  async castVote(choice: number): Promise<void> {
    const res = await this.contract.impureCircuits.castVote(this.ctx, BigInt(choice));
    this.ctx = res.context;
  }

  async closePoll(): Promise<void> {
    const res = await this.contract.impureCircuits.closePoll(this.ctx);
    this.ctx = res.context;
  }

  async hasVoted(nullifier: Uint8Array): Promise<boolean> {
    const res = await this.contract.impureCircuits.hasVoted(this.ctx, nullifier);
    this.ctx = res.context;
    return res.result;
  }

  /** Convenience: the tally for one option. */
  tallyOf(choice: number): bigint {
    const t = this.ledger().tallies;
    return t.member(BigInt(choice)) ? t.lookup(BigInt(choice)).read() : 0n;
  }

  /** Convenience: every tally, as an array indexed by choice. */
  allTallies(): bigint[] {
    const n = Number(this.ledger().optionCount);
    return Array.from({ length: n }, (_, i) => this.tallyOf(i));
  }
}

export function bytes32(label: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(label).subarray(0, 32));
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Hex with trailing zero bytes trimmed (matches the runtime's string form). */
export function trimHex(b: Uint8Array): string {
  return toHex(b).replace(/(00)+$/, '');
}
