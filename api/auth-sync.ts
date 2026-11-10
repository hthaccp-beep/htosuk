import { getAdmin } from './firebase-admin.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readExistingProfile } from '../server/profile-access.ts';

export default async function authSyncHandler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || !header.slice(7).trim()) {
    return res.status(401).json({ error: 'Missing authorization bearer token' });
  }
  let services;
  try { services = getAdmin(); }
  catch { return res.status(503).json({ error: 'HTOS database setup is incomplete.' }); }
  let decoded;
  try { decoded = await services.auth.verifyIdToken(header.slice(7).trim(), true); }
  catch { return res.status(401).json({ error: 'Invalid authentication token' }); }
  try {
    const user = await readExistingProfile(decoded.uid, async uid => {
      const snapshot = await services.db.collection('users').doc(uid).get();
      return snapshot.exists ? snapshot.data() : undefined;
    });
    if (!user) return res.status(403).json({ error: 'An active HTOS account must be configured by an administrator.' });
    return res.status(200).json({ success: true, user });
  } catch { return res.status(503).json({ error: 'Unable to load your HTOS account. Please retry.' }); }
}
