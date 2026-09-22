import type { ContractState, StampState, WalletState } from '../hooks/useMidnight';
import { shorten } from '../lib/hex';

interface Props {
  wallet: WalletState;
  contract: ContractState;
  stamp: StampState;
  iAmStamped: boolean | null;
  onStamp: () => void;
  onReset: () => void;
}

export function CircuitCall({ wallet, contract, stamp, iAmStamped, onStamp, onReset }: Props) {
  const ready = wallet.status === 'connected' && contract.status === 'joined';
  const busy = stamp.status === 'proving' || stamp.status === 'submitting';

  return (
    <section className="card card--accent">
      <header className="card__head">
        <h2>Stamp in</h2>
        <span className="mono muted">circuit: stamp()</span>
      </header>

      <p className="lede">
        Prove you hold an attendee secret and record a stamp for this event. The proof is generated on your machine;
        the chain receives only a nullifier.
      </p>

      <div className="steps">
        <Step n={1} done={wallet.status === 'connected'} active={wallet.status !== 'connected'}>
          Connect Lace on Preprod
        </Step>
        <Step n={2} done={contract.status === 'joined'} active={wallet.status === 'connected' && contract.status !== 'joined'}>
          {contract.status === 'joining' ? 'Joining contract…' : contract.status === 'error' ? `Join failed: ${contract.error}` : 'Join the ShadowStamp contract'}
        </Step>
        <Step n={3} done={stamp.status === 'done'} active={ready && stamp.status === 'idle'}>
          Generate proof &amp; submit
        </Step>
      </div>

      {stamp.status === 'idle' && (
        <button className="btn btn--primary btn--big" onClick={onStamp} disabled={!ready}>
          {iAmStamped ? 'Stamp again (will be rejected)' : 'Stamp in with a zero-knowledge proof'}
        </button>
      )}

      {busy && (
        <div className="status status--busy" aria-live="polite">
          <span className="spinner" aria-hidden />
          <div>
            <strong>Generating zero-knowledge proof…</strong>
            <span>
              Running the circuit locally with your private secret, then Lace will ask you to sign. This usually takes
              30–90 seconds.
            </span>
          </div>
        </div>
      )}

      {stamp.status === 'done' && (
        <div className="status status--ok" aria-live="polite">
          <div>
            <strong>Stamped. Transaction included on Preprod.</strong>
            <dl className="kv">
              <dt>tx id</dt>
              <dd className="mono" title={stamp.txId}>{shorten(stamp.txId, 16, 10)}</dd>
              <dt>block</dt>
              <dd className="mono">{stamp.blockHeight}</dd>
              <dt>status</dt>
              <dd className="mono">{stamp.txStatus}</dd>
            </dl>
            <span className="badge badge--proof">✓ Proved without revealing your input</span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>OK</button>
        </div>
      )}

      {stamp.status === 'rejected' && (
        <div className="status status--warn" aria-live="polite">
          <div>
            <strong>Rejected by the circuit: already stamped.</strong>
            <span>
              {stamp.reason} The contract recognised your nullifier without learning who you are — this is the
              double-stamp guard working.
            </span>
            <span className="badge badge--proof">✓ Proved without revealing your input</span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>OK</button>
        </div>
      )}

      {stamp.status === 'error' && (
        <div className="status status--err" role="alert">
          <div>
            <strong>Transaction failed.</strong>
            <span className="mono small">{stamp.error}</span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>Try again</button>
        </div>
      )}
    </section>
  );
}

function Step({ n, done, active, children }: { n: number; done: boolean; active: boolean; children: React.ReactNode }) {
  return (
    <div className={`step ${done ? 'step--done' : ''} ${active ? 'step--active' : ''}`}>
      <span className="step__n">{done ? '✓' : n}</span>
      <span>{children}</span>
    </div>
  );
}
