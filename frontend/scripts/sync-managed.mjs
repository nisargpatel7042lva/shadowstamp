// Copies the compiled Compact output into the frontend so the app is
// self-contained and resolves its imports against frontend/node_modules:
//
//   contract/ -> src/generated/shadowstamp/contract/  (JS bindings + types)
//   keys/     -> public/keys/                         (prover/verifier keys)
//   zkir/     -> public/zkir/                         (circuit IR)
//
// public/ is served at the app origin, which is what FetchZkConfigProvider
// fetches from at runtime. Both destinations are gitignored: contracts/managed
// in the repo root is the single source of truth.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const managedRoot = resolve(here, '..', '..', 'contracts', 'managed');
const managed = resolve(managedRoot, 'shadowstamp');
const managedBallot = resolve(managedRoot, 'shadowballot');
const publicDir = resolve(here, '..', 'public');
const generatedDir = resolve(here, '..', 'src', 'generated', 'shadowstamp');

if (!existsSync(resolve(managed, 'keys')) || !existsSync(resolve(managedBallot, 'keys'))) {
  console.error(`✗ ${managed}/keys not found — run \`npm run compile\` in the repo root first.`);
  process.exit(1);
}

const copy = (from, to, label) => {
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`✓ synced ${label}`);
};

copy(resolve(managed, 'contract'), resolve(generatedDir, 'contract'), 'shadowstamp/contract → src/generated');
copy(
  resolve(managedBallot, 'contract'),
  resolve(here, '..', 'src', 'generated', 'shadowballot', 'contract'),
  'shadowballot/contract → src/generated',
);

// Both contracts' keys and ZKIR are served flat from the app origin, which is
// what FetchZkConfigProvider fetches from. Circuit names are unique across the
// two contracts, so a single keys/ and zkir/ directory is unambiguous.
for (const dir of ['keys', 'zkir']) {
  const dest = resolve(publicDir, dir);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(resolve(managed, dir), dest, { recursive: true });
  cpSync(resolve(managedBallot, dir), dest, { recursive: true });
  console.log(`✓ synced both contracts' ${dir} → public/${dir}`);
}
