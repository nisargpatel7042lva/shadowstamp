import { shorten } from '../lib/hex';

interface Props {
  myNullifier: string | null;
  iAmStamped: boolean | null;
  hasSecret: boolean;
}

export function PrivacyPanel({ myNullifier, iAmStamped, hasSecret }: Props) {
  return (
    <section className="card">
      <header className="card__head">
        <h2>What stays hidden</h2>
        <span className="mono muted">witness: attendeeSecret()</span>
      </header>

      <dl className="privacy">
        <div className="privacy__row privacy__row--private">
          <dt>Your secret</dt>
          <dd>
            <code className="redacted" aria-label="secret is never displayed">
              ●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●●
            </code>
            <span className="muted small">
              {hasSecret
                ? '32 random bytes, stored only in this browser. Never displayed, never sent, never on-chain.'
                : 'Generated on first connect. Stored only in this browser.'}
            </span>
          </dd>
        </div>

        <div className="privacy__row">
          <dt>Your nullifier</dt>
          <dd>
            <code className="mono" title={myNullifier ?? undefined}>
              {myNullifier ? shorten(myNullifier, 14, 10) : '— connect to derive —'}
            </code>
            <span className="muted small">
              hash(secret, eventId). Public once you stamp, but nobody can invert it or link it to you.
            </span>
          </dd>
        </div>

        <div className="privacy__row">
          <dt>Status</dt>
          <dd>
            {iAmStamped === null ? (
              <span className="muted">unknown until the ledger loads</span>
            ) : iAmStamped ? (
              <span className="badge badge--ok">your nullifier is on-chain</span>
            ) : (
              <span className="badge">not stamped yet</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="observer">
        <h3>An on-chain observer sees</h3>
        <ul>
          <li>the event id and a counter</li>
          <li>a set of 32-byte nullifiers</li>
          <li>that each stamp came with a valid proof</li>
        </ul>
        <h3>…and cannot see</h3>
        <ul>
          <li>any attendee secret</li>
          <li>which wallet or person produced which nullifier</li>
          <li>whether the same person attended a different event</li>
        </ul>
      </div>
    </section>
  );
}
