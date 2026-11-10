import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { build } from 'vite';
import { validateCloudSetup } from '../server/htos-runtime.ts';

// Only VITE_ settings are included in the browser bundle by Vite.
config({ path: '.env.cloud.local', quiet: true });
validateCloudSetup(process.env);
const runtime = spawnSync(process.execPath, ['scripts/check-server-runtime.mjs'], {
  stdio: 'inherit', env: {...process.env, NODE_OPTIONS: ''},
});
if (runtime.error || runtime.status !== 0) process.exit(runtime.status || 1);
const check = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], {
  stdio: 'inherit', env: process.env,
});
if (check.error || check.status !== 0) process.exit(check.status || 1);
await build({ mode: 'cloud' });
