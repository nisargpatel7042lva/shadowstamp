import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowBallotSimulator, bytes32, toHex, trimHex } from './ballot-simulator.js';

const POLL_ID = bytes32('midnight-builder-challenge-l3');
const OPTIONS = 3; // 0 = yes, 1 = no, 2 = abstain

const ALICE = bytes32('alice-voter-secret-never-shared');
const BOB = bytes32('bob-voter-secret-never-shared');
const CAROL = bytes32('carol-voter-secret-never-shared');

describe('ShadowBallot contract', () => {
  let sim: ShadowBallotSimulator;

  beforeEach(async () => {
    sim = await ShadowBallotSimulator.open(POLL_ID, OPTIONS, ALICE);
  });

  // ── Circuit logic ────────────────────────────────────────────────────────

  describe('circuit logic', () => {
    it('opens with the disclosed poll id, option count, and an empty tally', () => {
      const l = sim.ledger();
      expect(toHex(l.pollId)).toBe(toHex(POLL_ID));
      expect(l.optionCount).toBe(BigInt(OPTIONS));
      expect(l.voteCount).toBe(0n);
      expect(l.closed).toBe(false);
      expect(l.ballots.isEmpty()).toBe(true);
      expect(sim.allTallies()).toEqual([0n, 0n, 0n]);
    });

    it('castVote records one nullifier and increments that option', async () => {
      await sim.castVote(1);
      const l = sim.ledger();
      expect(l.voteCount).toBe(1n);
      expect(l.ballots.size()).toBe(1n);
      expect(sim.allTallies()).toEqual([0n, 1n, 0n]);
    });

    it('rejects a choice outside the option range', async () => {
      await expect(sim.castVote(OPTIONS)).rejects.toThrow(/option out of range/);
      expect(sim.ledger().voteCount).toBe(0n);
    });

    it('rejects a second ballot from the same secret', async () => {
      await sim.castVote(0);
      await expect(sim.castVote(2)).rejects.toThrow(/already voted/);
      expect(sim.ledger().voteCount).toBe(1n);
      expect(sim.allTallies()).toEqual([1n, 0n, 0n]);
    });

    it('rejects voting once the poll is closed', async () => {
      await sim.closePoll();
      expect(sim.ledger().closed).toBe(true);
      await expect(sim.as(BOB).castVote(0)).rejects.toThrow(/poll is closed/);
      expect(sim.ledger().voteCount).toBe(0n);
    });

    it('hasVoted answers true for a recorded nullifier and false otherwise', async () => {
      await sim.castVote(0);
      const [nullifier] = [...sim.ledger().ballots];
      expect(await sim.hasVoted(nullifier)).toBe(true);
      expect(await sim.hasVoted(bytes32('not-a-real-nullifier'))).toBe(false);
    });
  });

  // ── State transitions ────────────────────────────────────────────────────

  describe('state transitions', () => {
    it('counts three different voters independently', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(1);
      await sim.as(CAROL).castVote(1);

      const l = sim.ledger();
      expect(l.voteCount).toBe(3n);
      expect(l.ballots.size()).toBe(3n);
      expect(sim.allTallies()).toEqual([1n, 2n, 0n]);
    });

    it('different voters produce distinct nullifiers', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(0);
      const nullifiers = [...sim.ledger().ballots].map(toHex);
      expect(new Set(nullifiers).size).toBe(2);
    });

    it('the same secret yields the same nullifier, so a repeat is caught after others vote', async () => {
      await sim.castVote(0);
      const [first] = [...sim.ledger().ballots].map(toHex);
      await sim.as(BOB).castVote(1);
      await expect(sim.as(ALICE).castVote(2)).rejects.toThrow(/already voted/);

      expect([...sim.ledger().ballots].map(toHex)).toContain(first);
      expect(sim.ledger().voteCount).toBe(2n);
    });

    it('a different poll gives the same secret an unrelated nullifier', async () => {
      await sim.castVote(0);
      const [inThisPoll] = [...sim.ledger().ballots].map(toHex);

      const other = await ShadowBallotSimulator.open(bytes32('a-totally-different-poll'), OPTIONS, ALICE);
      await other.castVote(0);
      const [inOtherPoll] = [...other.ledger().ballots].map(toHex);

      expect(inThisPoll).not.toBe(inOtherPoll);
    });

    it('closing is idempotent and leaves the tally final', async () => {
      await sim.castVote(2);
      await sim.closePoll();
      await sim.closePoll();
      expect(sim.ledger().closed).toBe(true);
      expect(sim.allTallies()).toEqual([0n, 0n, 1n]);
    });
  });

  // ── Public verifiability: the half that IS disclosed ─────────────────────

  describe('public verifiability', () => {
    it('the tallies always sum to the ballot count, so anyone can audit the result', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(2);
      await sim.as(CAROL).castVote(2);

      const l = sim.ledger();
      const sum = sim.allTallies().reduce((a, b) => a + b, 0n);
      expect(sum).toBe(l.voteCount);
      expect(sum).toBe(BigInt(l.ballots.size()));
    });

    it('one ballot per nullifier: the ballot set size equals the vote count', async () => {
      await sim.castVote(1);
      await sim.as(BOB).castVote(1);
      await expect(sim.as(ALICE).castVote(0)).rejects.toThrow(/already voted/);
      expect(sim.ledger().ballots.size()).toBe(2n);
      expect(sim.ledger().voteCount).toBe(2n);
    });
  });

  // ── Privacy: the half that stays in shadow ───────────────────────────────

  describe('privacy boundary', () => {
    it('no voter secret appears in the public ledger', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(1);

      for (const n of sim.ledger().ballots) {
        expect(n).toHaveLength(32);
        expect(toHex(n)).not.toBe(toHex(ALICE));
        expect(toHex(n)).not.toBe(toHex(BOB));
      }
      // Looking a secret up directly finds nothing.
      expect(await sim.hasVoted(ALICE)).toBe(false);
    });

    it('the serialised on-chain state contains no trace of the secrets', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(1);
      const serialised = sim.serializedLedger().toLowerCase();
      expect(serialised).not.toContain(trimHex(ALICE));
      expect(serialised).not.toContain(trimHex(BOB));
      // Sanity check: the state does carry the public poll id.
      expect(serialised).toContain(trimHex(POLL_ID));
    });

    it('the tally reveals the result without revealing who voted for what', async () => {
      await sim.castVote(0);
      await sim.as(BOB).castVote(1);

      // What an observer gets: counts and opaque nullifiers, in insertion-
      // independent order — nothing that ties a ballot to a voter.
      const nullifiers = [...sim.ledger().ballots].map(toHex);
      expect(sim.allTallies()).toEqual([1n, 1n, 0n]);
      expect(nullifiers).toHaveLength(2);
      for (const n of nullifiers) expect(n).toMatch(/^[0-9a-f]{64}$/);
    });

    it('the voter secret stays in private state on the voter side', async () => {
      await sim.castVote(0);
      expect(toHex(sim.privateState().secret)).toBe(toHex(ALICE));
    });
  });
});
