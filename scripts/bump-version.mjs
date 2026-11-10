import {readFileSync, writeFileSync} from 'node:fs';

// Run once for a new production release, not for preview builds or deployment retries.
const file = new URL('../app-version.json', import.meta.url);
const release = JSON.parse(readFileSync(file, 'utf8'));
if (!/^\d+\.\d+$/.test(release.version)) throw new Error('Expected a version such as 9.0 or 9.01.');
const [major, update] = release.version.split('.');
release.version = `${major}.${String(Number(update) + 1).padStart(2, '0')}`;
writeFileSync(file, JSON.stringify(release, null, 2) + '\n');
console.log(`HTOS version ${release.version}`);
