/**
 * A PrivateStateProvider backed by localStorage.
 *
 * The attendee's secret is the contract's only witness. It has to survive page
 * reloads (otherwise every reload would be a "new attendee"), but it must never
 * leave this browser. localStorage keeps it on-device; nothing here talks to
 * the network.
 *
 * Uint8Array fields are hex-encoded for JSON storage.
 */
import type { ContractAddress, SigningKey } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type {
  ExportPrivateStatesOptions,
  ExportSigningKeysOptions,
  ImportPrivateStatesOptions,
  ImportPrivateStatesResult,
  ImportSigningKeysOptions,
  ImportSigningKeysResult,
  PrivateStateExport,
  PrivateStateId,
  PrivateStateProvider,
  SigningKeyExport,
} from '@midnight-ntwrk/midnight-js-types';
import { fromHex, toHex } from './hex';

const NS = 'shadowstamp:private-state';

function encode(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v instanceof Uint8Array ? { __bytes: toHex(v) } : v,
  );
}

function decode<T>(raw: string): T {
  return JSON.parse(raw, (_k, v) =>
    v && typeof v === 'object' && typeof v.__bytes === 'string' ? fromHex(v.__bytes) : v,
  ) as T;
}

export function localStoragePrivateStateProvider<PSI extends PrivateStateId, PS>(): PrivateStateProvider<PSI, PS> {
  let contractAddress: ContractAddress | null = null;

  const requireAddress = (): ContractAddress => {
    if (contractAddress === null) throw new Error('Contract address not set on private state provider.');
    return contractAddress;
  };
  const stateKey = (id: PSI) => `${NS}:${requireAddress()}:${id}`;
  const signingKeyKey = (addr: ContractAddress) => `${NS}:signing-key:${addr}`;
  const statePrefix = () => `${NS}:${requireAddress()}:`;

  const keysWithPrefix = (prefix: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) out.push(k);
    }
    return out;
  };

  return {
    setContractAddress(address) {
      contractAddress = address;
    },
    async set(key, state) {
      localStorage.setItem(stateKey(key), encode(state));
    },
    async get(key) {
      const raw = localStorage.getItem(stateKey(key));
      return raw === null ? null : decode<PS>(raw);
    },
    async remove(key) {
      localStorage.removeItem(stateKey(key));
    },
    async clear() {
      for (const k of keysWithPrefix(statePrefix())) localStorage.removeItem(k);
    },
    async setSigningKey(addr, signingKey) {
      localStorage.setItem(signingKeyKey(addr), signingKey);
    },
    async getSigningKey(addr) {
      return localStorage.getItem(signingKeyKey(addr)) as SigningKey | null;
    },
    async removeSigningKey(addr) {
      localStorage.removeItem(signingKeyKey(addr));
    },
    async clearSigningKeys() {
      for (const k of keysWithPrefix(`${NS}:signing-key:`)) localStorage.removeItem(k);
    },
    async exportPrivateStates(_options?: ExportPrivateStatesOptions): Promise<PrivateStateExport> {
      const address = requireAddress();
      const states: Record<string, string> = {};
      for (const k of keysWithPrefix(statePrefix())) states[k.slice(statePrefix().length)] = localStorage.getItem(k)!;
      return { format: 'midnight-private-state-export', encryptedPayload: encode({ contractAddress: address, states }), salt: 'local-storage' };
    },
    async importPrivateStates(exportData: PrivateStateExport, options?: ImportPrivateStatesOptions): Promise<ImportPrivateStatesResult> {
      const payload = decode<{ states?: Record<string, string> }>(exportData.encryptedPayload);
      const strategy = options?.conflictStrategy ?? 'error';
      let imported = 0, skipped = 0, overwritten = 0;
      for (const [id, raw] of Object.entries(payload.states ?? {})) {
        const k = stateKey(id as PSI);
        const exists = localStorage.getItem(k) !== null;
        if (exists) {
          if (strategy === 'skip') { skipped++; continue; }
          if (strategy === 'error') throw new Error(`Private state conflict for '${id}'`);
          overwritten++;
        } else imported++;
        localStorage.setItem(k, raw);
      }
      return { imported, skipped, overwritten };
    },
    async exportSigningKeys(_options?: ExportSigningKeysOptions): Promise<SigningKeyExport> {
      const keys: Record<string, string> = {};
      for (const k of keysWithPrefix(`${NS}:signing-key:`)) keys[k.slice(`${NS}:signing-key:`.length)] = localStorage.getItem(k)!;
      return { format: 'midnight-signing-key-export', encryptedPayload: encode({ keys }), salt: 'local-storage' };
    },
    async importSigningKeys(exportData: SigningKeyExport, options?: ImportSigningKeysOptions): Promise<ImportSigningKeysResult> {
      const payload = decode<{ keys?: Record<string, string> }>(exportData.encryptedPayload);
      const strategy = options?.conflictStrategy ?? 'error';
      let imported = 0, skipped = 0, overwritten = 0;
      for (const [addr, key] of Object.entries(payload.keys ?? {})) {
        const k = signingKeyKey(addr as ContractAddress);
        const exists = localStorage.getItem(k) !== null;
        if (exists) {
          if (strategy === 'skip') { skipped++; continue; }
          if (strategy === 'error') throw new Error(`Signing key conflict for '${addr}'`);
          overwritten++;
        } else imported++;
        localStorage.setItem(k, key);
      }
      return { imported, skipped, overwritten };
    },
  };
}
