/**
 * Browser wiring for the ShadowBallot poll.
 *
 * Mirrors lib/contract.ts: the compiled contract plus the witness that feeds
 * the voter's secret into the circuit, and a JS mirror of the contract's
 * nullifier hash so the UI can show a voter their own nullifier without
 * sending a transaction.
 */
import './network'; // configures the SDK's global network id before anything else
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import * as ShadowBallot from '../generated/shadowballot/contract/index.js';
import type { Contract, Ledger, Witnesses } from '../generated/shadowballot/contract/index.js';

export const CONTRACT_NAME = 'shadowballot';
export const PRIVATE_STATE_ID = 'shadowballotPrivateState';
export type BallotCircuitKeys = 'castVote' | 'closePoll' | 'hasVoted';

export type BallotPrivateState = {
  readonly secret: Uint8Array;
};

export const witnesses: Witnesses<BallotPrivateState> = {
  voterSecret: ({ privateState }) => [privateState, privateState.secret],
};

export const compiledBallot = CompiledContract.make<Contract<BallotPrivateState>>(
  CONTRACT_NAME,
  ShadowBallot.Contract,
).pipe(CompiledContract.withWitnesses(witnesses));

export type ShadowBallotContract = Contract<BallotPrivateState>;

export const readBallotLedger = (data: Parameters<typeof ShadowBallot.ledger>[0]): Ledger =>
  ShadowBallot.ledger(data);

export function newSecret(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

// Must match `pad(32, "shadowballot:nullifier:v1")` in the Compact source.
const DOMAIN = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode('shadowballot:nullifier:v1'));
  return b;
})();
const VEC3_BYTES32 = new CompactTypeVector(3, new CompactTypeBytes(32));

export function deriveBallotNullifier(secret: Uint8Array, pollId: Uint8Array): Uint8Array {
  return persistentHash(VEC3_BYTES32, [DOMAIN, secret, pollId]);
}

/** Tallies as an array indexed by choice. */
export function talliesOf(l: Ledger): bigint[] {
  const n = Number(l.optionCount);
  return Array.from({ length: n }, (_, i) =>
    l.tallies.member(BigInt(i)) ? l.tallies.lookup(BigInt(i)).read() : 0n,
  );
}
