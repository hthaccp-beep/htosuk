// Never derive authority from decoded claims, email names or seed accounts.
export async function verifySession(auth: any, token: string) {
  return auth.verifyIdToken(token.trim(), true);
}

export async function activeProfile(db: any, uid: string) {
  const snapshot = await db.collection('users').doc(uid).get();
  const profile = snapshot.data();
  return snapshot.exists && profile?.active === true ? {...profile, id: uid} : undefined;
}
