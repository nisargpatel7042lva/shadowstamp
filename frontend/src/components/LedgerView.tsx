import type { PublicLedger } from '../hooks/useMidnight';
import { CONTRACT_ADDRESS, NETWORK_ID } from '../lib/config';
import { shorten } from '../lib/hex';

interface Props {
  ledger: PublicLedger | null;
  myNullifier: string | null;
  onRefresh: () => void;
}

export function LedgerView({ ledger, myNullifier, onRefresh }: Props) {
  return (
    <section className="card card--wide">
      <header className="card__head">
        <h2>Public ledger</h2>
        <div className="row">
          <span className="mono muted">read from the {NETWORK_ID} indexer</span>
          <button className="btn btn--ghost btn--sm" onClick={onRefresh}>Refresh</button>
        </div>
      </header>

      {!ledger ? (
        <p className="muted">Loading contract state…</p>
      ) : (
        <>
          <dl className="kv kv--grid">
            <dt>contract</dt>
            <dd className="mono" title={CONTRACT_ADDRESS}>{shorten(CONTRACT_ADDRESS, 18, 12)}</dd>
            <dt>eventId</dt>
            <dd className="mono" title={ledger.eventId}>{shorten(ledger.eventId, 18, 12)}</dd>
            <dt>stampCount</dt>
            <dd className="mono big">{ledger.stampCount.toString()}</dd>
          </dl>

          <h3 className="muted">stamps · {ledger.stamps.length} nullifier{ledger.stamps.length === 1 ? '' : 's'}</h3>
          {ledger.stamps.length === 0 ? (
            <p className="muted">No stamps yet. Be the first.</p>
          ) : (
            <ul className="nullifiers">
              {ledger.stamps.map((n) => {
                const mine = n === myNullifier;
                return (
                  <li key={n} className={mine ? 'mine' : ''}>
                    <code className="mono">{n}</code>
                    {mine && <span className="pill pill--mine">yours — only you can tell</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
