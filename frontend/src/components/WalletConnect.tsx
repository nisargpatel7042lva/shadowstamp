import { useState } from 'react';
import type { WalletState } from '../hooks/useMidnight';
import { shorten } from '../lib/hex';

interface Props {
  wallet: WalletState;
  onConnect: () => void;
  onDisconnect: () => void;
}

const HINTS: Record<string, string> = {
  'not-installed': 'Install the Midnight Lace extension from the Chrome Web Store, then reload this page.',
  rejected: 'Open Lace and approve the connection request, then try again.',
  'network-mismatch': 'In Lace: Settings → Network → Preprod. Then reconnect.',
  unknown: 'Check that Lace is unlocked and on Preprod, then try again.',
};

export function WalletConnect({ wallet, onConnect, onDisconnect }: Props) {
  const [copied, setCopied] = useState(false);

  if (wallet.status === 'connected') {
    const { session, prover } = wallet;
    const copy = async () => {
      await navigator.clipboard.writeText(session.unshieldedAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    };
    return (
      <div className="wallet wallet--connected">
        <span className="dot dot--on" aria-hidden />
        <div className="wallet__meta">
          <div className="wallet__name">
            {session.walletName} · <span className="pill">{session.networkId}</span>{' '}
            <span className="pill pill--muted" title="Where zero-knowledge proofs are generated">
              prover: {prover === 'lace' ? 'Lace (local)' : 'proof server'}
            </span>
          </div>
          <button className="wallet__addr" onClick={copy} title={session.unshieldedAddress}>
            <code>{shorten(session.unshieldedAddress, 18, 8)}</code>
            <span className="wallet__copy">{copied ? 'copied' : 'copy'}</span>
          </button>
        </div>
        <button className="btn btn--ghost" onClick={onDisconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="wallet">
      <span className={`dot ${wallet.status === 'connecting' ? 'dot--busy' : ''}`} aria-hidden />
      <div className="wallet__meta">
        <div className="wallet__name">
          {wallet.status === 'connecting' ? 'Waiting for Lace…' : 'Wallet not connected'}
        </div>
        {wallet.status === 'disconnected' && wallet.error && (
          <div className="wallet__error" role="alert">
            <strong>{wallet.error.message}</strong>
            <span>{HINTS[wallet.error.kind]}</span>
          </div>
        )}
      </div>
      <button className="btn btn--primary" onClick={onConnect} disabled={wallet.status === 'connecting'}>
        {wallet.status === 'connecting' ? 'Connecting…' : 'Connect Lace'}
      </button>
    </div>
  );
}
