export type Environment = Record<string, string | undefined>;

export function readHtosConfig(env: Environment, client = false) {
  const prefix = client ? 'VITE_' : '';
  const mode = env[prefix + 'HTOS_MODE'] || 'disabled';
  const projectId = env[prefix + 'FIREBASE_PROJECT_ID'] || '';
  if (mode === 'disabled') throw new Error('HTOS needs its own database configuration before you can sign in.');
  if (!['emulator', 'cloud'].includes(mode)) throw new Error('HTOS database mode is invalid.');
  if (!projectId || projectId === 'ordersystemv3') throw new Error('HTOS must use a separate database project.');
  if (mode === 'emulator' && projectId !== 'demo-htos') throw new Error('Local testing requires the demo-htos project.');
  if (mode === 'cloud' && (projectId.startsWith('demo-') || env[prefix + 'HTOS_CLOUD_PROJECT_ID'] !== projectId)) {
    throw new Error('The separate HTOS cloud project must be explicitly configured.');
  }
  return { mode, projectId };
}

export function assertLocalEmulatorHost(value: string | undefined, expectedPort: number) {
  if (value !== '127.0.0.1:' + expectedPort) throw new Error('HTOS emulators must use the configured local address.');
  return value;
}
