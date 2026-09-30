import type { PollState, VoteState } from '../hooks/useBallot';
import { shorten } from '../lib/hex';

interface Props {
  poll: PollState | null;
  options: string[];
  vote: VoteState;
  myNullifier: string | null;
  iHaveVoted: boolean | null;
  joined: boolean;
  walletConnected: boolean;
  onVote: (choice: number) => void;
  onReset: () => void;
  onRefresh: () => void;
}

export function BallotCard({
  poll, options, vote, myNullifier, iHaveVoted, joined, walletConnected, onVote, onReset, onRefresh,
}: Props) {
  const busy = vote.status === 'voting';
  const ready = walletConnected && joined && poll && !poll.closed && !busy;
  const total = poll ? poll.tallies.reduce((a, b) => a + b, 0n) : 0n;
  const audited = poll ? total === poll.voteCount : false;
  const max = poll ? poll.tallies.reduce((a, b) => (b > a ? b : a), 0n) : 0n;

  return (
    <section className="card card--accent card--wide">
      <header className="card__head">
        <h2>Anonymous ballot</h2>
        <span className="mono muted">circuit: castVote()</span>
      </header>

      <p className="lede">
        Cast one ballot per secret. The chain records your <em>choice</em> so the result can be audited, and a
        nullifier instead of your identity so the ballot cannot be traced back to you.
      </p>

      {!poll ? (
        <p className="muted">Loading poll…</p>
      ) : (
        <>
          <div className="options">
            {options.map((label, i) => {
              const count = poll.tallies[i] ?? 0n;
              const pct = poll.voteCount > 0n ? Number((count * 100n) / poll.voteCount) : 0;
              const leading = count === max && count > 0n;
              return (
                <button
                  key={i}
                  className={`option ${leading ? 'option--lead' : ''}`}
                  onClick={() => onVote(i)}
                  disabled={!ready}
                  title={ready ? `Vote ${label}` : 'Connect Lace to vote'}
                >
                  <span className="option__bar" style={{ width: `${pct}%` }} aria-hidden />
                  <span className="option__label">{label}</span>
                  <span className="option__count mono">
                    {count.toString()}
                    <span className="muted small"> · {pct}%</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="audit">
            <span className="mono">
              {poll.voteCount.toString()} ballot{poll.voteCount === 1n ? '' : 's'} · tallies sum to {total.toString()}
            </span>
            <span className={`badge ${audited ? 'badge--ok' : 'badge--warn'}`}>
              {audited ? '✓ tally audited' : '✗ tally mismatch'}
            </span>
            {poll.closed && <span className="badge">poll closed</span>}
            <button className="btn btn--ghost btn--sm" onClick={onRefresh}>Refresh</button>
          </div>

          <div className="voter">
            <div>
              <span className="muted small">your ballot nullifier</span>
              <code className="mono" title={myNullifier ?? undefined}>
                {myNullifier ? shorten(myNullifier, 14, 10) : '— connect to derive —'}
              </code>
            </div>
            {iHaveVoted === true && <span className="badge badge--ok">you have voted</span>}
            {iHaveVoted === false && <span className="badge">not voted yet</span>}
          </div>
        </>
      )}

      {busy && (
        <div className="status status--busy" aria-live="polite">
          <span className="spinner" aria-hidden />
          <div>
            <strong>Proving your ballot for “{options[vote.choice]}”…</strong>
            <span>The circuit runs locally with your secret, then Lace asks you to sign. 30–90 seconds.</span>
          </div>
        </div>
      )}

      {vote.status === 'done' && (
        <div className="status status--ok" aria-live="polite">
          <div>
            <strong>Ballot for “{options[vote.choice]}” recorded on Preprod.</strong>
            <dl className="kv">
              <dt>tx id</dt><dd className="mono" title={vote.txId}>{shorten(vote.txId, 16, 10)}</dd>
              <dt>block</dt><dd className="mono">{vote.blockHeight}</dd>
            </dl>
            <span className="badge badge--proof">✓ Counted without revealing who you are</span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>OK</button>
        </div>
      )}

      {vote.status === 'rejected' && (
        <div className="status status--warn" aria-live="polite">
          <div>
            <strong>Rejected by the circuit.</strong>
            <span>
              {vote.reason} The contract recognised your nullifier without ever learning your secret — that is the
              one-ballot-per-voter guarantee doing its job.
            </span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>OK</button>
        </div>
      )}

      {vote.status === 'error' && (
        <div className="status status--err" role="alert">
          <div>
            <strong>Vote failed.</strong>
            <span className="mono small">{vote.error}</span>
          </div>
          <button className="btn btn--ghost" onClick={onReset}>Try again</button>
        </div>
      )}
    </section>
  );
}
