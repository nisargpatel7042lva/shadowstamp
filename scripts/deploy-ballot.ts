/**
 * Deploy a ShadowBallot poll to a Midnight network.
 *
 *   npm run deploy:ballot -- --network preprod
 *
 * Options and the poll label are set here (see src/ballot.ts); the label is
 * hashed into the 32-byte pollId that binds every nullifier to this poll.
 * Needs the proof server running and a wallet holding DUST.
 */
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateWallet } from '../src/network';
import { withSubmissionRetry } from '../src/submit-retry';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from '../src/wallet';
import {
  compiledContract,
  zkConfigPath,
  PRIVATE_STATE_ID,
  DEFAULT_POLL_LABEL,
  DEFAULT_OPTIONS,
  pollIdFromLabel,
  newSecret,
  toHex,
  recordBallotDeployment,
  type ShadowBallotPrivateState,
} from '../src/ballot';

// @ts-expect-error wallet sync requires a global WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);

const POLL_LABEL = process.env.SHADOWBALLOT_POLL?.trim() || DEFAULT_POLL_LABEL;
const POLL_ID = pollIdFromLabel(POLL_LABEL);
const OPTIONS = DEFAULT_OPTIONS;

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

async function main() {
  console.log(`\nnetwork  : ${network}`);
  console.log(`poll     : ${POLL_LABEL}`);
  console.log(`pollId   : ${toHex(POLL_ID)}`);
  console.log(`options  : ${OPTIONS.map((o, i) => `${i}=${o}`).join('  ')}\n`);

  const reachable = await fetch(networkConfig.proofServer, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  console.log(reachable ? 'proof server reachable\n' : '⚠ proof server NOT reachable — proving will fail\n');

  console.log('Syncing wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  const state = await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);
  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`  address : ${walletCtx.unshieldedKeystore.getBech32Address()}`);
  console.log(`  tNIGHT  : ${tNight.toLocaleString()}`);
  console.log(`  DUST    : ${state.dust.balance(new Date()).toLocaleString()}\n`);

  const providers = createProviders(walletCtx);

  // The wallet SDK closes its relay socket when nothing is subscribed to
  // wallet.state(); submitting through a closed socket fails with
  // "SubmissionError: ... 1000 Normal Closure". Hold a subscription across the
  // deploy. Same reason scripts/stamp.ts does it.
  const keepAlive = walletCtx.wallet.state().subscribe({ error: () => {} });
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));

  console.log('Deploying poll — proving, balancing, signing, submitting...');
  const started = Date.now();
  try {
    const initialPrivateState: ShadowBallotPrivateState = { secret: newSecret() };
    const deployed = await withSubmissionRetry(
      () =>
        deployContract(providers as any, {
          compiledContract: compiledContract as any,
          args: [POLL_ID, BigInt(OPTIONS.length)],
          privateStateId: PRIVATE_STATE_ID,
          initialPrivateState,
        }),
      { label: 'deploy' },
    );

    const address = deployed.deployTxData.public.contractAddress;
    console.log(`\n✅ POLL DEPLOYED in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`  contract : ${address}\n`);

    recordBallotDeployment({
      address,
      network,
      pollLabel: POLL_LABEL,
      pollId: toHex(POLL_ID),
      options: [...OPTIONS],
      deployedAt: new Date().toISOString(),
    });
    console.log('  saved to .midnight-ballot.json\n');
  } catch (err: any) {
    console.error(`\n❌ DEPLOY FAILED after ${Math.round((Date.now() - started) / 1000)}s`);
    console.error(`  message : ${err?.message ?? err}`);
    if (err?.cause) console.error(`  cause   : ${err.cause?.message ?? err.cause}`);
    keepAlive.unsubscribe();
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  keepAlive.unsubscribe();
  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
