/**
 * Browser-side wiring for the ShadowStamp contract.
 *
 * - `witnesses` supplies the private secret from local private state.
 * - `deriveNullifier` mirrors the contract's hash so the UI can show the user
 *   their own (public, unlinkable) nullifier and check membership without a
 *   transaction. It is a pure function of (secret, eventId).
 */
// Side-effect import: configures the SDK's global network id before the
// CompiledContract below is built. See ./network.
import './network';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import { CompactTypeBytes, CompactTypeVector, persistentHash } from '@midnight-ntwrk/compact-runtime';
import * as ShadowStamp from '../generated/shadowstamp/contract/index.js';
import type { Contract, Ledger, Witnesses } from '../generated/shadowstamp/contract/index.js';

export const CONTRACT_NAME = 'shadowstamp';
export const PRIVATE_STATE_ID = 'shadowstampPrivateState';
export type CircuitKeys = 'stamp' | 'hasStamped';

export type ShadowStampPrivateState = {
  readonly secret: Uint8Array;
};

export const witnesses: Witnesses<ShadowStampPrivateState> = {
  attendeeSecret: ({ privateState }) => [privateState, privateState.secret],
};

export const compiledContract = CompiledContract.make<Contract<ShadowStampPrivateState>>(
  CONTRACT_NAME,
  ShadowStamp.Contract,
).pipe(CompiledContract.withWitnesses(witnesses));

export type ShadowStampContract = Contract<ShadowStampPrivateState>;

export const readLedger = (data: Parameters<typeof ShadowStamp.ledger>[0]): Ledger => ShadowStamp.ledger(data);

export function newSecret(): Uint8Array {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return b;
}

// Must match `pad(32, "shadowstamp:nullifier:v1")` in the Compact source.
const DOMAIN = (() => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode('shadowstamp:nullifier:v1'));
  return b;
})();
const VEC3_BYTES32 = new CompactTypeVector(3, new CompactTypeBytes(32));

export function deriveNullifier(secret: Uint8Array, eventId: Uint8Array): Uint8Array {
  return persistentHash(VEC3_BYTES32, [DOMAIN, secret, eventId]);
}
