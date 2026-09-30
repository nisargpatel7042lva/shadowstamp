/**
 * useBallot — the poll half of the dApp.
 *
 * Reuses the wallet session established by useMidnight and adds:
 *   poll   : the public tally, polled from the indexer (no wallet needed)
 *   me     : this browser's voter nullifier, derived locally from a secret
 *            that never leaves the device
 *   vote() : run the castVote circuit — proof, sign, submit
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findDeployedContract, type FoundContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';

import { BALLOT_ADDRESS, NETWORK_ID, POLL_OPTIONS } from '../lib/config';
import { localStoragePrivateStateProvider } from '../lib/private-state';
import {
  compiledBallot,
  deriveBallotNullifier,
  newSecret,
  readBallotLedger,
  talliesOf,
  PRIVATE_STATE_ID,
  type BallotPrivateState,
  type ShadowBallotContract,
} from '../lib/ballot';
import { toHex } from '../lib/hex';

export interface PollState {
  pollId: string;
  optionCount: number;
  tallies: bigint[];
  voteCount: bigint;
  closed: boolean;
  ballots: string[];
}

export type VoteState =
  | { status: 'idle' }
  | { status: 'voting'; choice: number }
  | { status: 'done'; choice: number; txId: string; blockHeight: number }
  | { status: 'rejected'; reason: string }
  | { status: 'error'; error: string };

const POLL_MS = 12_000;

const publicData = (queryUrl: string, subscriptionUrl: string) =>
  // Same reason as useMidnight: isomorphic-ws has no named WebSocket export in
  // the browser, so the default would be undefined and subscriptions would fail.
  indexerPublicDataProvider(queryUrl, subscriptionUrl, WebSocket as never);

export function useBallot(providers: unknown | null, walletReady: boolean) {
  const [poll, setPoll] = useState<PollState | null>(null);
  const [vote, setVote] = useState<VoteState>({ status: 'idle' });
  const [myNullifier, setMyNullifier] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const deployedRef = useRef<FoundContract<ShadowBallotContract> | null>(null);

  const privateStateProvider = useMemo(
    () => localStoragePrivateStateProvider<typeof PRIVATE_STATE_ID, BallotPrivateState>(),
    [],
  );

  const refresh = useCallback(async () => {
    if (!BALLOT_ADDRESS) return;
    const pdp = publicData(
      `https://indexer.${NETWORK_ID}.midnight.network/api/v4/graphql`,
      `wss://indexer.${NETWORK_ID}.midnight.network/api/v4/graphql/ws`,
    );
    const state = await pdp.queryContractState(BALLOT_ADDRESS);
    if (!state) return;
    const l = readBallotLedger(state.data);
    setPoll({
      pollId: toHex(l.pollId),
      optionCount: Number(l.optionCount),
      tallies: talliesOf(l),
      voteCount: l.voteCount,
      closed: l.closed,
      ballots: [...l.ballots].map(toHex),
    });
  }, []);

  useEffect(() => {
    void refresh().catch((e) => console.warn('poll read failed', e));
    const t = setInterval(() => void refresh().catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  // Derive this browser's nullifier once the poll id is known.
  useEffect(() => {
    if (!poll?.pollId) return;
    void (async () => {
      privateStateProvider.setContractAddress(BALLOT_ADDRESS);
      const ps = await privateStateProvider.get(PRIVATE_STATE_ID);
      if (!ps) { setMyNullifier(null); return; }
      const pollIdBytes = new Uint8Array(poll.pollId.match(/../g)!.map((h) => parseInt(h, 16)));
      setMyNullifier(toHex(deriveBallotNullifier(ps.secret, pollIdBytes)));
    })();
  }, [poll?.pollId, privateStateProvider]);

  // Join the poll contract once the wallet providers exist.
  useEffect(() => {
    if (!walletReady || !providers || !BALLOT_ADDRESS || deployedRef.current) return;
    void (async () => {
      try {
        privateStateProvider.setContractAddress(BALLOT_ADDRESS);
        const existing = await privateStateProvider.get(PRIVATE_STATE_ID);
        const initialPrivateState: BallotPrivateState = existing ?? { secret: newSecret() };
        deployedRef.current = await findDeployedContract<ShadowBallotContract>(
          { ...(providers as object), privateStateProvider } as never,
          {
            contractAddress: BALLOT_ADDRESS,
            compiledContract: compiledBallot as never,
            privateStateId: PRIVATE_STATE_ID,
            initialPrivateState,
          },
        );
        setJoined(true);
        if (poll?.pollId) {
          const pollIdBytes = new Uint8Array(poll.pollId.match(/../g)!.map((h) => parseInt(h, 16)));
          setMyNullifier(toHex(deriveBallotNullifier(initialPrivateState.secret, pollIdBytes)));
        }
      } catch (e) {
        setVote({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, [walletReady, providers, privateStateProvider, poll?.pollId]);

  const castVote = useCallback(
    async (choice: number) => {
      const deployed = deployedRef.current as any;
      if (!deployed) return;
      setVote({ status: 'voting', choice });
      try {
        const tx = await deployed.callTx.castVote(BigInt(choice));
        setVote({ status: 'done', choice, txId: tx.public.txId, blockHeight: tx.public.blockHeight });
        void refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/already voted/i.test(msg)) {
          setVote({ status: 'rejected', reason: 'This secret has already voted in this poll.' });
        } else if (/poll is closed/i.test(msg)) {
          setVote({ status: 'rejected', reason: 'The poll is closed.' });
        } else {
          setVote({ status: 'error', error: msg });
        }
      }
    },
    [refresh],
  );

  const iHaveVoted = useMemo(
    () => (myNullifier && poll ? poll.ballots.includes(myNullifier) : null),
    [myNullifier, poll],
  );

  const options = useMemo(
    () => (poll ? Array.from({ length: poll.optionCount }, (_, i) => POLL_OPTIONS[i] ?? `Option ${i}`) : POLL_OPTIONS),
    [poll],
  );

  return { poll, options, vote, myNullifier, iHaveVoted, joined, castVote, refresh, resetVote: () => setVote({ status: 'idle' }) };
}
