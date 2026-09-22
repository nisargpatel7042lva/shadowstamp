// Copies the compiled circuit artefacts (prover/verifier keys + ZKIR) from the
// contract's managed/ output into public/ so the browser can fetch them via
// FetchZkConfigProvider at <origin>/keys/<circuit>.prover and /zkir/<circuit>.bzkir.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const managed = resolve(here, '..', '..', 'contracts', 'managed', 'shadowstamp');
const publicDir = resolve(here, '..', 'public');

if (!existsSync(resolve(managed, 'keys'))) {
  console.error(`✗ ${managed}/keys not found — run \`npm run compile\` in the repo root first.`);
  process.exit(1);
}

for (const dir of ['keys', 'zkir']) {
  const dest = resolve(publicDir, dir);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(resolve(managed, dir), dest, { recursive: true });
  console.log(`✓ synced managed/${dir} → public/${dir}`);
}
