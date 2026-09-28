/**
 * Non-interactive stamp: runs the `stamp` circuit once against the deployed
 * contract and prints the ledger before and after.
 *
 * This is the whole write path — circuit execution, proof generation, fee
 * balancing, signing and submission — with no wallet extension involved, which
 * makes it the fastest way to tell a contract/chain problem apart from a
 * browser or wallet one.
 *
 *   npm run stamp -- --network preprod
 *
 * Needs the proof server running (npm run proof-server:start) and a funded
 * wallet with NIGHT registered for DUST generation.
 */
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { resolveNetwork, getOrCreateWallet, getDeployment } from '../src/network';
import { createWallet, persistWalletState, unshieldedToken, type WalletContext } from '../src/wallet';
import {
  ShadowStamp,
  compiledContract,
  zkConfigPath,
  PRIVATE_STATE_ID,
  newSecret,
  toHex,
  type ShadowStampPrivateState,
} from '../src/contract';

// @ts-expect-error wallet sync requires a global WebSocket
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);

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
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'shadowstamp-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

async function readLedger(providers: ReturnType<typeof createProviders>, address: string) {
  const state = await providers.publicDataProvider.queryContractState(address);
  if (!state) return null;
  const l = ShadowStamp.ledger(state.data);
  return { eventId: toHex(l.eventId), stampCount: l.stampCount, stamps: [...l.stamps].map(toHex) };
}

async function main() {
  const deployment = getDeployment(network);
  if (!deployment) {
    console.error(`No deployment on file for ${network}.`);
    process.exit(1);
  }
  console.log(`\nnetwork  : ${network}`);
  console.log(`contract : ${deployment.address}\n`);

  console.log('Checking proof server...');
  const res = await fetch(networkConfig.proofServer, { signal: AbortSignal.timeout(5000) }).catch(() => null);
  console.log(res ? '  proof server reachable\n' : '  ⚠ proof server NOT reachable — proving will fail\n');

  console.log('Syncing wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: WALLET.seed });
  const state = await walletCtx.wallet.waitForSyncedState();
  await persistWalletState(network, walletCtx);

  const tNight = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  const dust = state.dust.balance(new Date());
  console.log(`  address : ${walletCtx.unshieldedKeystore.getBech32Address()}`);
  console.log(`  tNIGHT  : ${tNight.toLocaleString()}`);
  console.log(`  DUST    : ${dust.toLocaleString()}\n`);
  if (dust === 0n) console.log('  ⚠ No DUST — fees cannot be paid. Register NIGHT for DUST generation first.\n');

  const providers = createProviders(walletCtx);

  const before = await readLedger(providers, deployment.address);
  console.log(`ledger before : stampCount=${before?.stampCount} stamps=${before?.stamps.length}\n`);

  console.log('Joining contract...');
  providers.privateStateProvider.setContractAddress(deployment.address);
  const existing = await providers.privateStateProvider.get(PRIVATE_STATE_ID);
  const initialPrivateState: ShadowStampPrivateState = (existing as ShadowStampPrivateState) ?? { secret: newSecret() };
  const deployed: any = await findDeployedContract(providers as any, {
    contractAddress: deployment.address,
    compiledContract: compiledContract as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });
  console.log('  joined\n');

  // Keep the wallet's state stream hot. deploy.ts polls wallet.state() right
  // up to the moment it submits and its submissions succeed; this script did
  // not, and its relay socket was closed ("Normal Closure") by submit time.
  const keepAlive = walletCtx.wallet.state().subscribe({ error: () => {} });
  await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s: any) => s.isSynced)));

  console.log('Calling stamp() — proving, balancing, signing, submitting...');
  const started = Date.now();
  try {
    const tx = await deployed.callTx.stamp();
    console.log(`\n✅ STAMPED in ${Math.round((Date.now() - started) / 1000)}s`);
    console.log(`  txId        : ${tx.public.txId}`);
    console.log(`  blockHeight : ${tx.public.blockHeight}`);
    console.log(`  status      : ${tx.public.status}\n`);
  } catch (err: any) {
    console.error(`\n❌ STAMP FAILED after ${Math.round((Date.now() - started) / 1000)}s`);
    console.error(`  message : ${err?.message ?? err}`);
    if (err?.cause) console.error(`  cause   : ${err.cause?.message ?? err.cause}`);
    console.error(err?.stack?.split('\n').slice(0, 6).join('\n') ?? '');
    keepAlive.unsubscribe();
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  keepAlive.unsubscribe();

  const after = await readLedger(providers, deployment.address);
  console.log(`ledger after  : stampCount=${after?.stampCount} stamps=${after?.stamps.length}`);
  after?.stamps.forEach((s) => console.log(`   - ${s}`));

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
