/**
 * Shared contract wiring for ShadowStamp.
 *
 * Loads the compiled Compact output, defines the private state shape and the
 * witness implementations, and exposes helpers used by deploy.ts, cli.ts and
 * the e2e check so the three never drift apart.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { Contract, Witnesses } from '../contracts/managed/shadowstamp/contract/index.js';

export const CONTRACT_NAME = 'shadowstamp';

/** Identifier under which this contract's private state is stored locally. */
export const PRIVATE_STATE_ID = 'shadowstampPrivateState';

/**
 * Private state kept on the attendee's machine. `secret` is the witness
 * value fed into the `stamp` circuit. It is never written to the ledger.
 */
export type ShadowStampPrivateState = {
  readonly secret: Uint8Array;
};

export const witnesses: Witnesses<ShadowStampPrivateState> = {
  attendeeSecret: ({ privateState }) => [privateState, privateState.secret],
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', CONTRACT_NAME);
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

export const ShadowStamp: typeof import('../contracts/managed/shadowstamp/contract/index.js') =
  await import(pathToFileURL(contractPath).href);

export const compiledContract = CompiledContract.make<Contract<ShadowStampPrivateState>>(
  CONTRACT_NAME,
  ShadowStamp.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

/** 32-byte event id derived from a human-readable label. */
export function eventIdFromLabel(label: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`shadowstamp:event:${label}`).digest());
}

/** Fresh random attendee secret. */
export function newSecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
}

/** Event label used when none is supplied via SHADOWSTAMP_EVENT. */
export const DEFAULT_EVENT_LABEL = 'midnight-builder-challenge-l1';
