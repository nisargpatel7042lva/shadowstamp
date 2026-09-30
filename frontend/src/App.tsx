import { useMidnight } from './hooks/useMidnight';
import { useBallot } from './hooks/useBallot';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';
import { PrivacyPanel } from './components/PrivacyPanel';
import { LedgerView } from './components/LedgerView';
import { BallotCard } from './components/BallotCard';
import { BALLOT_ADDRESS, CONTRACT_ADDRESS, EVENT_LABEL, NETWORK_ID, POLL_LABEL } from './lib/config';

export default function App() {
  const m = useMidnight();
  const walletConnected = m.wallet.status === 'connected';
  const b = useBallot(m.providers, walletConnected);

  return (
    <div className="page">
      <header className="top">
        <a className="brand" href={import.meta.env.BASE_URL}>
          <Crescent />
          <span>ShadowStamp</span>
        </a>
        <WalletConnect wallet={m.wallet} onConnect={m.connect} onDisconnect={m.disconnect} />
      </header>

      <main>
        <section className="hero">
          <p className="eyebrow">Midnight · {NETWORK_ID} · {POLL_LABEL}</p>
          <h1>Count every vote.<br />Identify no voter.</h1>
          <p className="lede">
            Anonymous ballots with publicly verifiable tallies. Each voter holds a private secret; casting a ballot
            publishes the choice — so anyone can audit the result — and an unlinkable nullifier instead of an
            identity. One ballot per secret, zero identity leakage.
          </p>
        </section>

        <div className="grid">
          <BallotCard
            poll={b.poll}
            options={b.options}
            vote={b.vote}
            myNullifier={b.myNullifier}
            iHaveVoted={b.iHaveVoted}
            joined={b.joined}
            walletConnected={walletConnected}
            onVote={b.castVote}
            onReset={b.resetVote}
            onRefresh={() => void b.refresh()}
          />

          <CircuitCall
            wallet={m.wallet}
            contract={m.contract}
            stamp={m.stamp}
            iAmStamped={m.iAmStamped}
            onStamp={m.stampIn}
            onReset={m.resetStamp}
            onRetryJoin={m.connect}
          />
          <PrivacyPanel myNullifier={m.myNullifier} iAmStamped={m.iAmStamped} hasSecret={m.myNullifier !== null} />
          <LedgerView ledger={m.ledger} myNullifier={m.myNullifier} onRefresh={() => void m.refreshLedger()} />
        </div>
      </main>

      <footer className="foot">
        <span className="mono muted">
          poll {BALLOT_ADDRESS} · stamp {CONTRACT_ADDRESS}
        </span>
        <a href="https://github.com/nisargpatel7042lva/shadowstamp" target="_blank" rel="noreferrer">
          source
        </a>
      </footer>
    </div>
  );
}

function Crescent() {
  return (
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden>
      <circle cx="32" cy="32" r="18" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M32 14a18 18 0 0 1 0 36 12 12 0 0 0 0-36z" fill="currentColor" />
    </svg>
  );
}
