/**
 * Shared contract wiring for ShadowBallot.
 *
 * Mirrors contract.ts: loads the compiled Compact output, defines the private
 * state shape and witness implementation, and exposes the helpers used by the
 * deploy and vote scripts so they cannot drift apart.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import type { Contract, Witnesses } from '../contracts/managed/shadowballot/contract/index.js';

export const CONTRACT_NAME = 'shadowballot';

/** Identifier under which this contract's private state is stored locally. */
export const PRIVATE_STATE_ID = 'shadowballotPrivateState';

/** Private state on the voter's machine. Never written to the ledger. */
export type ShadowBallotPrivateState = {
  readonly secret: Uint8Array;
};

export const witnesses: Witnesses<ShadowBallotPrivateState> = {
  voterSecret: ({ privateState }) => [privateState, privateState.secret],
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const zkConfigPath = path.resolve(__dirname, '..', 'contracts', 'managed', CONTRACT_NAME);
const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compile\n');
  process.exit(1);
}

export const ShadowBallot: typeof import('../contracts/managed/shadowballot/contract/index.js') =
  await import(pathToFileURL(contractPath).href);

export const compiledContract = CompiledContract.make<Contract<ShadowBallotPrivateState>>(
  CONTRACT_NAME,
  ShadowBallot.Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);

/** 32-byte poll id derived from a human-readable label. */
export function pollIdFromLabel(label: string): Uint8Array {
  return new Uint8Array(createHash('sha256').update(`shadowballot:poll:${label}`).digest());
}

export function newSecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

export function toHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

export function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex.replace(/^0x/, ''), 'hex'));
}

export const DEFAULT_POLL_LABEL = 'midnight-builder-challenge-l3';

/** The options this poll is deployed with, in order. Index = ballot choice. */
export const DEFAULT_OPTIONS = ['Yes', 'No', 'Abstain'] as const;

/** Where the deployed poll address is recorded (gitignored). */
export const BALLOT_STATE_FILE = '.midnight-ballot.json';

export interface BallotDeployment {
  address: string;
  network: string;
  pollLabel: string;
  pollId: string;
  options: readonly string[];
  deployedAt: string;
}

export function recordBallotDeployment(d: BallotDeployment, cwd = process.cwd()): void {
  fs.writeFileSync(path.join(cwd, BALLOT_STATE_FILE), `${JSON.stringify(d, null, 2)}\n`);
}

export function loadBallotDeployment(cwd = process.cwd()): BallotDeployment | null {
  const p = path.join(cwd, BALLOT_STATE_FILE);
  return fs.existsSync(p) ? (JSON.parse(fs.readFileSync(p, 'utf-8')) as BallotDeployment) : null;
}
