import { spawnSync } from 'node:child_process';

for (const script of ['scripts/emulator-smoke.ts', 'scripts/order-scope-smoke.ts', 'scripts/workflow-smoke.ts', 'scripts/admin-workflow-smoke.ts', 'scripts/import-emulator-check.ts']) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
