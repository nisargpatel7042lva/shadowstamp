/**
 * Sets the SDK's global network id.
 *
 * `@midnight-ntwrk/midnight-js-network-id` keeps the active network in
 * module-level state, and `midnight-js-contracts` reads it via `getNetworkId()`
 * when joining a contract or submitting a circuit call. If it was never set,
 * those operations fail with:
 *
 *   Network ID has not been configured. Call setNetworkId() before any wallet
 *   or contract operation
 *
 * The Node scripts do this in `src/wallet.ts`; the browser needs its own call.
 * Importing this module performs it at load time — before any event handler can
 * run — so modules that touch the SDK import `NETWORK_ID` from here rather than
 * from `./config`, which makes the ordering explicit instead of incidental.
 */
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { NETWORK_ID } from './config';

setNetworkId(NETWORK_ID);

export { NETWORK_ID };
