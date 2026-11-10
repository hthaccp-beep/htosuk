export const DATABASE_QUOTA_MESSAGE = 'Database usage limit reached. HTOS cannot load or save data right now. Please wait for the quota to reset or contact your administrator. Repeated retries will not resolve this limit.';
export function isDatabaseQuotaError(error: unknown): boolean {
 if (!error || typeof error !== 'object') return false;
 const e=error as {code?: unknown; message?: unknown};
 return e.code===8 || e.code==='8' || e.code==='resource-exhausted' || e.code==='firestore/resource-exhausted' || e.code==='DATABASE_QUOTA_EXCEEDED' || (typeof e.message==='string' && /(?:quota (?:exceeded|limit)|resource[_ -]exhausted|database usage limit reached)/i.test(e.message));
}
export function databaseErrorMessage(error: unknown, fallback: string): string {
 return isDatabaseQuotaError(error) ? DATABASE_QUOTA_MESSAGE : fallback;
}
