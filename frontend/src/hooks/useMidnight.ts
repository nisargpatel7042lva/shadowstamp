/**
 * useMidnight — one hook that owns the whole Midnight.js session:
 *
 *   wallet   : Lace connect / disconnect (DApp connector API)
 *   contract : join the deployed ShadowStamp contract on Preprod
 *   ledger   : the public on-chain state, polled from the indexer
 *   me       : this browser's private secret (never rendered) and the
 *              nullifier derived from it (public, unlinkable)
 *   stamp()  : run the `stamp` circuit — proof + balance + sign + submit
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findDeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { createProofProvider, type ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { toHex as sdkToHex, fromHex as sdkFromHex } from '@midnight-ntwrk/midnight-js-utils';
import { Transaction, type FinalizedTransaction, type TransactionId } from '@midnight-ntwrk/midnight-js-protocol/ledger';
import type { UnboundTransaction } from '@midnight-ntwrk/midnight-js-types';

import { CONTRACT_ADDRESS } from '../lib/config';
import { NETWORK_ID } from '../lib/network';
import { connectLace, WalletError, type WalletSession } from '../lib/wallet';
import { localStoragePrivateStateProvider } from '../lib/private-state';
import {
  compiledContract,
  deriveNullifier,
  newSecret,
  readLedger,
  PRIVATE_STATE_ID,
  type CircuitKeys,
  type ShadowStampContract,
  type ShadowStampPrivateState,
} from '../lib/contract';
import { toHex } from '../lib/hex';

export type WalletState =
  | { status: 'disconnected'; error?: WalletError }
  | { status: 'connecting' }
  | { status: 'connected'; session: WalletSession; prover: 'lace' | 'proof-server' };

export type ContractState =
  | { status: 'idle' }
  | { status: 'joining' }
  | { status: 'joined' }
  | { status: 'error'; error: string };

export interface PublicLedger {
  eventId: string;
  stampCount: bigint;
  stamps: string[];
}

export type StampState =
  | { status: 'idle' }
  | { status: 'proving' }
  | { status: 'submitting' }
  | { status: 'done'; txId: string; blockHeight: number; txStatus: string }
  | { status: 'rejected'; reason: string }
  | { status: 'error'; error: string };

type Deployed = FoundContract<ShadowStampContract>;

const LEDGER_POLL_MS = 12_000;

/**
 * The indexer provider defaults its WebSocket implementation to
 * `isomorphic-ws`'s named `WebSocket` export, which does not exist in the
 * browser build (that file only has a default export). Left unset, GraphQL
 * subscriptions — which is how the SDK waits for a transaction to finalize —
 * would be constructed with `undefined`. Pass the browser's own WebSocket.
 */
const publicDataProvider = (queryUrl: string, subscriptionUrl: string) =>
  indexerPublicDataProvider(queryUrl, subscriptionUrl, WebSocket as never);

export function useMidnight() {
  const [wallet, setWallet] = useState<WalletState>({ status: 'disconnected' });
  const [contract, setContract] = useState<ContractState>({ status: 'idle' });
  const [ledger, setLedger] = useState<PublicLedger | null>(null);
  const [stamp, setStamp] = useState<StampState>({ status: 'idle' });
  const [myNullifier, setMyNullifier] = useState<string | null>(null);

  const deployedRef = useRef<Deployed | null>(null);
  const providersRef = useRef<Parameters<typeof findDeployedContract>[0] | null>(null);
  const privateStateProvider = useMemo(
    () => localStoragePrivateStateProvider<typeof PRIVATE_STATE_ID, ShadowStampPrivateState>(),
    [],
  );

  // ── Public ledger (needs no wallet: the indexer is public) ────────────────
  const refreshLedger = useCallback(async (indexerUri?: string, indexerWsUri?: string) => {
    if (!CONTRACT_ADDRESS) return;
    const uri = indexerUri ?? `https://indexer.${NETWORK_ID}.midnight.network/api/v4/graphql`;
    const ws = indexerWsUri ?? `wss://indexer.${NETWORK_ID}.midnight.network/api/v4/graphql/ws`;
    const pdp = publicDataProvider(uri, ws);
    const state = await pdp.queryContractState(CONTRACT_ADDRESS);
    if (!state) return;
    const l = readLedger(state.data);
    setLedger({
      eventId: toHex(l.eventId),
      stampCount: l.stampCount,
      stamps: [...l.stamps].map(toHex),
    });
  }, []);

  useEffect(() => {
    void refreshLedger().catch((e) => console.warn('ledger read failed', e));
    const t = setInterval(() => void refreshLedger().catch(() => {}), LEDGER_POLL_MS);
    return () => clearInterval(t);
  }, [refreshLedger]);

  // ── Local nullifier (derived from the private secret, never the secret) ──
  const recomputeNullifier = useCallback(async (eventIdHex: string | undefined) => {
    if (!eventIdHex) return;
    privateStateProvider.setContractAddress(CONTRACT_ADDRESS);
    const ps = await privateStateProvider.get(PRIVATE_STATE_ID);
    if (!ps) { setMyNullifier(null); return; }
    setMyNullifier(toHex(deriveNullifier(ps.secret, sdkFromHex(eventIdHex))));
  }, [privateStateProvider]);

  useEffect(() => {
    void recomputeNullifier(ledger?.eventId);
  }, [ledger?.eventId, recomputeNullifier]);

  // ── Wallet ────────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    setWallet({ status: 'connecting' });
    setContract({ status: 'idle' });
    try {
      const session = await connectLace(NETWORK_ID);

      // Circuit keys/ZKIR are served next to the app (see scripts/sync-managed.mjs).
      const zkBase = new URL(import.meta.env.BASE_URL, window.location.origin).href.replace(/\/$/, '');
      const zkConfigProvider = new FetchZkConfigProvider<CircuitKeys>(zkBase, fetch.bind(window));

      // Prefer proving through Lace itself (proof never leaves the user's
      // machine); fall back to the proof server Lace is configured with.
      let proofProvider: ProofProvider;
      let prover: 'lace' | 'proof-server';
      try {
        const provingProvider = await session.api.getProvingProvider(zkConfigProvider as never);
        proofProvider = createProofProvider(provingProvider as never);
        prover = 'lace';
      } catch {
        if (!session.proverServerUri) throw new WalletError('unknown', 'Lace has no proof server configured.');
        proofProvider = httpClientProofProvider(session.proverServerUri, zkConfigProvider);
        prover = 'proof-server';
      }

      const walletProvider = {
        getCoinPublicKey: () => session.shieldedCoinPublicKey,
        getEncryptionPublicKey: () => session.shieldedEncryptionPublicKey,
        balanceTx: async (tx: UnboundTransaction, _ttl?: Date): Promise<FinalizedTransaction> => {
          const balanced = await session.api.balanceUnsealedTransaction(sdkToHex(tx.serialize()));
          return Transaction.deserialize('signature', 'proof', 'binding', sdkFromHex(balanced.tx));
        },
      };
      const midnightProvider = {
        submitTx: async (tx: FinalizedTransaction): Promise<TransactionId> => {
          await session.api.submitTransaction(sdkToHex(tx.serialize()));
          return tx.identifiers()[0];
        },
      };

      providersRef.current = {
        privateStateProvider,
        zkConfigProvider,
        proofProvider,
        publicDataProvider: publicDataProvider(session.indexerUri, session.indexerWsUri),
        walletProvider,
        midnightProvider,
      } as never;

      setWallet({ status: 'connected', session, prover });
      void refreshLedger(session.indexerUri, session.indexerWsUri);

      // ── Join the deployed contract ─────────────────────────────────────
      setContract({ status: 'joining' });
      privateStateProvider.setContractAddress(CONTRACT_ADDRESS);
      const existing = await privateStateProvider.get(PRIVATE_STATE_ID);
      const initialPrivateState: ShadowStampPrivateState = existing ?? { secret: newSecret() };

      deployedRef.current = await findDeployedContract<ShadowStampContract>(providersRef.current!, {
        contractAddress: CONTRACT_ADDRESS,
        compiledContract: compiledContract as never,
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState,
      });
      setContract({ status: 'joined' });
    } catch (e) {
      const err = e instanceof WalletError ? e : new WalletError('unknown', e instanceof Error ? e.message : String(e), e);
      deployedRef.current = null;
      providersRef.current = null;
      if (err.kind === 'unknown' && wallet.status === 'connected') {
        setContract({ status: 'error', error: err.message });
      } else {
        setWallet({ status: 'disconnected', error: err });
        setContract({ status: 'idle' });
      }
    }
  }, [privateStateProvider, refreshLedger, wallet.status]);

  const disconnect = useCallback(() => {
    // The connector API has no explicit disconnect; the dApp drops its handle.
    // The user can revoke the site in Lace → Settings → dApps.
    deployedRef.current = null;
    providersRef.current = null;
    setWallet({ status: 'disconnected' });
    setContract({ status: 'idle' });
    setStamp({ status: 'idle' });
  }, []);

  // ── Circuit call ──────────────────────────────────────────────────────────
  const stampIn = useCallback(async () => {
    const deployed = deployedRef.current;
    if (!deployed) return;
    setStamp({ status: 'proving' });
    try {
      // callTx: runs the circuit locally, proves, balances via Lace (user
      // signs), submits. The private secret is consumed by the proof and
      // never leaves this browser.
      const result = await deployed.callTx.stamp();
      setStamp({
        status: 'done',
        txId: result.public.txId,
        blockHeight: result.public.blockHeight,
        txStatus: String(result.public.status),
      });
      const s = wallet.status === 'connected' ? wallet.session : undefined;
      void refreshLedger(s?.indexerUri, s?.indexerWsUri);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/already stamped/i.test(msg)) {
        setStamp({ status: 'rejected', reason: 'The circuit rejected a second stamp from this secret.' });
      } else {
        setStamp({ status: 'error', error: msg });
      }
    }
  }, [refreshLedger, wallet]);

  const resetStamp = useCallback(() => setStamp({ status: 'idle' }), []);

  const iAmStamped = useMemo(
    () => (myNullifier && ledger ? ledger.stamps.includes(myNullifier) : null),
    [myNullifier, ledger],
  );

  return { wallet, contract, ledger, stamp, myNullifier, iAmStamped, connect, disconnect, stampIn, resetStamp, refreshLedger };
}
