export async function readExistingProfile(uid: string, load: (uid: string) => Promise<Record<string, unknown> | undefined>) {
  const profile = await load(uid);
  if (!profile || profile.active !== true) return null;
  const { password, passwordHash, ...safe } = profile;
  return { ...safe, id: uid };
}
