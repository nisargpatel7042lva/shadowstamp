/**
 * Cast one anonymous ballot against the deployed poll, non-interactively.
 *
 *   npm run vote -- --choice 1 --network preprod
 *
 * Prints the tally before and after, which is the whole point of the contract:
 * the result is publicly auditable while the voter stays anonymous. Needs the
 * proof server running and a wallet holding DUST.
 */
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateWallet } from '../src/network';
import { createWallet, persistWalletState, type WalletContext } from '../src/wallet';
import { withSubmissionRetry } from '../src/submit-retry';
import {
  ShadowBallot,
  compiledContract,
  zkConfigPath,
  PRIVATE_STATE_ID,
  newSecret,
  toHex,
  loadBallotDeployment,
  type ShadowBallotPrivateState,
} from '../src/ballot';

// @ts-expect-error wallet sync requires a global WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);

function parseChoice(argv: string[]): number {
  const i = argv.indexOf('--choice');
  const raw = i >= 0 ? argv[i + 1] : process.env.SHADOWBALLOT_CHOICE;
  const n = Number(raw ?? 0);
  if (!Number.isInteger(n) || n < 0) throw new Error(`--choice must be a non-negative integer, got ${raw}`);
  return n;
}

function createProviders(walletCtx: WalletContext) {
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'shadowballot-state',
      accountId: walletCtx.unshieldedKeystore.getBech32Address().toString(),
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function readPoll(providers: ReturnType<typeof createProviders>, address: string) {
  const state = await providers.publicDataProvider.queryContractState(address);
  if (!state) return null;
  const l = ShadowBallot.ledger(state.data);
  const n = Number(l.optionCount);
  const tallies = Array.from({ length: n }, (_, i) =>
    l.tallies.member(BigInt(i)) ? l.tallies.lookup(BigInt(i)).read() : 0n,
  );
  return { pollId: toHex(l.pollId), optionCount: n, voteCount: l.voteCount, closed: l.closed, tallies };
}

function render(poll: NonNullable<Awaited<ReturnType<typeof readPoll>>>, options: readonly string[]) {
  const sum = poll.tallies.reduce((a, b) => a + b, 0n);
  poll.tallies.forEach((t, i) => console.log(`    ${i} ${(options[i] ?? `option ${i}`).padEnd(10)} ${t}`));
  console.log(`    total ballots: ${poll.voteCount}  (tallies sum to ${sum} — ${sum === poll.voteCount ? 'audited ✓' : 'MISMATCH ✗'})`);
}

async function main() {
  const deployment = loadBallotDeployment();
  if (!deployment) {
    console.error('No poll on file. Run: npm run deploy:ballot -- --network preprod');
    process.exit(1);
  }
  const choice = parseChoice(process.argv);
  const options = deployment.options;

  console.log(`\nnetwork  : ${network}`);
  console.log(`poll     : ${deployment.pollLabel}`);
  console.log(`contract : ${deployment.address}`);
  console.log(`choice   : ${choice} (${options[choice] ?? '?'})\n`);

  const reachable = await fetch(networkConfig.proofServer, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  console.log(reachable ? 'proof server reachable\n' : '⚠ proof server NOT reachable — proving will fail\n');

  console.log('Syncing wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const providers = createProviders(walletCtx);

  const before = await readPoll(providers, deployment.address);
  if (before) { console.log('\ntally before:'); render(before, options); }

  console.log('\nJoining poll...');
  providers.privateStateProvider.setContractAddress(deployment.address);
  const existing = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  const initialPrivateState: ShadowBallotPrivateState =
    (existing as ShadowBallotPrivateState) ?? { secret: newSecret() };
  const deployed: any = await findDeployedContract(providers as any, {
    contractAddress: deployment.address,
    compiledContract: compiledContract as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });
  console.log('  joined');

  // The SDK drops its relay socket when nothing is subscribed to
  // wallet.state(); keep one open across the call. See src/submit-retry.ts.
  const keepAlive = walletCtx.wallet.state().subscribe({ error: () => {} });
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));

  console.log('\nCasting ballot — proving, balancing, signing, submitting...');
  const started = Date.now();
  try {
    const tx = await withSubmissionRetry(() => deployed.callTx.castVote(BigInt(choice)), { label: 'vote' });
    console.log(`\n✅ BALLOT CAST in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`  txId        : ${tx.public.txId}`);
    console.log(`  blockHeight : ${tx.public.blockHeight}`);
    console.log(`  status      : ${tx.public.status}`);
  } catch (err: any) {
    console.error(`\n❌ VOTE FAILED after ${Math.round((Date.now() - started) / 1000)}s`);
    console.error(`  message : ${err?.message ?? err}`);
    if (err?.cause) console.error(`  cause   : ${err.cause?.message ?? err.cause}`);
    keepAlive.unsubscribe();
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  keepAlive.unsubscribe();

  const after = await readPoll(providers, deployment.address);
  if (after) { console.log('\ntally after:'); render(after, options); }

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
