/**
 * Lace wallet discovery + connection through the Midnight DApp connector API.
 *
 * Lace injects `window.midnight.<rdns>` with an `InitialAPI`. Calling
 * `connect(networkId)` prompts the user to authorise this site and returns a
 * `ConnectedAPI` we use to read addresses, balance/sign transactions, and
 * (optionally) prove locally.
 */
import type { ConnectedAPI, InitialAPI, APIError } from '@midnight-ntwrk/dapp-connector-api';
import semver from 'semver';
import { COMPATIBLE_CONNECTOR_API_VERSION } from './config';

export type WalletErrorKind = 'not-installed' | 'rejected' | 'network-mismatch' | 'unknown';

export class WalletError extends Error {
  constructor(public readonly kind: WalletErrorKind, message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'WalletError';
  }
}

export function findLace(): InitialAPI | undefined {
  const injected = window.midnight;
  if (!injected) return undefined;
  return Object.values(injected).find(
    (w): w is InitialAPI =>
      !!w && typeof w === 'object' && 'apiVersion' in w && semver.satisfies(w.apiVersion, COMPATIBLE_CONNECTOR_API_VERSION),
  );
}

/** Poll briefly for the extension — it may inject a few hundred ms after load. */
export async function waitForLace(timeoutMs = 1500): Promise<InitialAPI> {
  const start = Date.now();
  for (;;) {
    const api = findLace();
    if (api) return api;
    if (Date.now() - start > timeoutMs) {
      throw new WalletError('not-installed', 'Midnight Lace wallet not found. Install the Lace extension and reload.');
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

function isApiError(e: unknown): e is APIError {
  return !!e && typeof e === 'object' && (e as APIError).type === 'DAppConnectorAPIError';
}

export interface WalletSession {
  api: ConnectedAPI;
  walletName: string;
  unshieldedAddress: string;
  shieldedCoinPublicKey: string;
  shieldedEncryptionPublicKey: string;
  networkId: string;
  indexerUri: string;
  indexerWsUri: string;
  proverServerUri?: string;
}

export async function connectLace(networkId: string): Promise<WalletSession> {
  const initial = await waitForLace();

  let api: ConnectedAPI;
  try {
    api = await initial.connect(networkId);
  } catch (e) {
    if (isApiError(e) && (e.code === 'Rejected' || e.code === 'PermissionRejected')) {
      throw new WalletError('rejected', 'Connection request was rejected in Lace.', e);
    }
    const msg = e instanceof Error ? e.message : String(e);
    if (/network/i.test(msg)) {
      throw new WalletError('network-mismatch', `Lace is not on the "${networkId}" network. Switch networks in Lace and try again.`, e);
    }
    throw new WalletError('unknown', `Could not connect to Lace: ${msg}`, e);
  }

  const status = await api.getConnectionStatus();
  if (status.status !== 'connected') {
    throw new WalletError('rejected', 'Lace reports the dApp is not connected.');
  }
  if (status.networkId.toLowerCase() !== networkId.toLowerCase()) {
    throw new WalletError(
      'network-mismatch',
      `Lace is on "${status.networkId}" but this dApp targets "${networkId}". Switch networks in Lace and reconnect.`,
    );
  }

  const [config, shielded, unshielded] = await Promise.all([
    api.getConfiguration(),
    api.getShieldedAddresses(),
    api.getUnshieldedAddress(),
  ]);

  return {
    api,
    walletName: initial.name,
    unshieldedAddress: unshielded.unshieldedAddress,
    shieldedCoinPublicKey: shielded.shieldedCoinPublicKey,
    shieldedEncryptionPublicKey: shielded.shieldedEncryptionPublicKey,
    networkId: status.networkId,
    indexerUri: config.indexerUri,
    indexerWsUri: config.indexerWsUri,
    proverServerUri: config.proverServerUri,
  };
}
