/** Public, build-time configuration (see frontend/.env). Nothing secret here. */
export const NETWORK_ID: string = import.meta.env.VITE_NETWORK_ID ?? 'preprod';
export const CONTRACT_ADDRESS: string = import.meta.env.VITE_CONTRACT_ADDRESS ?? '';
export const EVENT_LABEL: string = import.meta.env.VITE_EVENT_LABEL ?? 'midnight-builder-challenge-l1';

/** DApp connector API major version this UI is written against. */
export const COMPATIBLE_CONNECTOR_API_VERSION = '4.x';

if (!CONTRACT_ADDRESS) {
  console.warn('VITE_CONTRACT_ADDRESS is not set — the UI cannot join a contract.');
}
