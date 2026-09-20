import { describe, it, expect, beforeEach } from 'vitest';
import { ShadowStampSimulator, bytes32, toHex, trimHex } from './simulator.js';

const EVENT_ID = bytes32('midnight-builder-challenge-l1');
const ALICE_SECRET = bytes32('alice-super-secret-never-shared');
const BOB_SECRET = bytes32('bob-super-secret-never-shared');

describe('ShadowStamp contract', () => {
  let sim: ShadowStampSimulator;

  beforeEach(async () => {
    sim = await ShadowStampSimulator.deploy(EVENT_ID, ALICE_SECRET);
  });

  // ── Circuit logic ────────────────────────────────────────────────────────

  describe('circuit logic', () => {
    it('initialises with the disclosed event id and an empty stamp set', () => {
      const l = sim.ledger();
      expect(toHex(l.eventId)).toBe(toHex(EVENT_ID));
      expect(l.stampCount).toBe(0n);
      expect(l.stamps.isEmpty()).toBe(true);
    });

    it('stamp() records exactly one nullifier and increments the counter', async () => {
      await sim.stamp();
      const l = sim.ledger();
      expect(l.stampCount).toBe(1n);
      expect(l.stamps.size()).toBe(1n);
    });

    it('rejects a second stamp from the same secret (double-stamp protection)', async () => {
      await sim.stamp();
      await expect(sim.stamp()).rejects.toThrow(/already stamped/);
      expect(sim.ledger().stampCount).toBe(1n);
    });

    it('hasStamped() answers true for a recorded nullifier and false otherwise', async () => {
      await sim.stamp();
      const [nullifier] = [...sim.ledger().stamps];
      expect(await sim.hasStamped(nullifier)).toBe(true);
      expect(await sim.hasStamped(bytes32('not-a-real-nullifier'))).toBe(false);
    });
  });

  // ── State transitions ────────────────────────────────────────────────────

  describe('state transitions', () => {
    it('two different attendees produce two distinct nullifiers and count = 2', async () => {
      await sim.stamp();
      await sim.as(BOB_SECRET).stamp();

      const l = sim.ledger();
      const nullifiers = [...l.stamps].map(toHex);
      expect(l.stampCount).toBe(2n);
      expect(nullifiers).toHaveLength(2);
      expect(new Set(nullifiers).size).toBe(2);
    });

    it('the same secret yields the same nullifier, so state is idempotent across users', async () => {
      await sim.stamp();
      const [first] = [...sim.ledger().stamps].map(toHex);

      // Bob stamps, then Alice tries again — Alice's nullifier must already exist.
      await sim.as(BOB_SECRET).stamp();
      await expect(sim.as(ALICE_SECRET).stamp()).rejects.toThrow(/already stamped/);

      const after = [...sim.ledger().stamps].map(toHex);
      expect(after).toContain(first);
      expect(sim.ledger().stampCount).toBe(2n);
    });

    it('a different event id produces a different nullifier for the same secret', async () => {
      await sim.stamp();
      const [nullifierEventA] = [...sim.ledger().stamps].map(toHex);

      const other = await ShadowStampSimulator.deploy(bytes32('a-totally-different-event'), ALICE_SECRET);
      await other.stamp();
      const [nullifierEventB] = [...other.ledger().stamps].map(toHex);

      expect(nullifierEventA).not.toBe(nullifierEventB);
    });
  });

  // ── Privacy: private inputs are never exposed ────────────────────────────

  describe('privacy boundary', () => {
    it('the raw secret never appears in the public ledger', async () => {
      await sim.stamp();
      const l = sim.ledger();

      // The stored value is a hash, not the secret itself.
      for (const n of l.stamps) {
        expect(n).toHaveLength(32);
        expect(toHex(n)).not.toBe(toHex(ALICE_SECRET));
      }
      // Looking up the secret directly finds nothing.
      expect(await sim.hasStamped(ALICE_SECRET)).toBe(false);
    });

    it('the serialised on-chain state contains no trace of the secret bytes', async () => {
      await sim.stamp();
      await sim.as(BOB_SECRET).stamp();
      // The runtime's string form trims trailing zero bytes, so compare on the
      // trimmed hex of each value to avoid a false negative.
      const serialised = sim.serializedLedger().toLowerCase();
      expect(serialised).not.toContain(trimHex(ALICE_SECRET));
      expect(serialised).not.toContain(trimHex(BOB_SECRET));
      // Sanity check that the serialised state does carry the (public) event id.
      expect(serialised).toContain(trimHex(EVENT_ID));
    });

    it('the secret stays in private state on the attendee side', async () => {
      await sim.stamp();
      expect(toHex(sim.privateState().secret)).toBe(toHex(ALICE_SECRET));
    });
  });
});
