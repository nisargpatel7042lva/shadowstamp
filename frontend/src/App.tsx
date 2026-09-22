import { useMidnight } from './hooks/useMidnight';
import { WalletConnect } from './components/WalletConnect';
import { CircuitCall } from './components/CircuitCall';
import { PrivacyPanel } from './components/PrivacyPanel';
import { LedgerView } from './components/LedgerView';
import { CONTRACT_ADDRESS, EVENT_LABEL, NETWORK_ID } from './lib/config';

export default function App() {
  const m = useMidnight();

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
          <p className="eyebrow">Midnight · {NETWORK_ID} · {EVENT_LABEL}</p>
          <h1>Prove you were here.<br />Reveal nothing else.</h1>
          <p className="lede">
            A zero-knowledge stamp card. Each attendee holds a private secret; stamping in publishes only an
            unlinkable nullifier. One stamp per secret, zero identity leakage.
          </p>
        </section>

        <div className="grid">
          <CircuitCall
            wallet={m.wallet}
            contract={m.contract}
            stamp={m.stamp}
            iAmStamped={m.iAmStamped}
            onStamp={m.stampIn}
            onReset={m.resetStamp}
          />
          <PrivacyPanel myNullifier={m.myNullifier} iAmStamped={m.iAmStamped} hasSecret={m.myNullifier !== null} />
          <LedgerView ledger={m.ledger} myNullifier={m.myNullifier} onRefresh={() => void m.refreshLedger()} />
        </div>
      </main>

      <footer className="foot">
        <span className="mono muted">contract {CONTRACT_ADDRESS}</span>
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
