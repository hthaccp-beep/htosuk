import { 
  decryptBranchEmailPassword, 
  encryptBranchEmailPassword, 
  BRANCH_EMAIL_COLLECTION 
} from './branch-email-settings.ts';
import type { StoredBranchEmailSettings } from './branch-email-settings.ts';

export interface MigrationResult {
  migratedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: string[];
}

/**
 * Controlled migration for branch email settings passwords when rotating encryption keys.
 * Decrypts with the verified old key and re-encrypts with the new key in memory.
 * Never prints, logs, or returns any plaintext password.
 */
export async function migrateBranchEmailEncryptionKey(params: {
  oldKey: string;
  newKey: string;
  getSettingsList: () => Promise<Array<{ branchId: string; data: StoredBranchEmailSettings }>>;
  saveSetting: (branchId: string, data: StoredBranchEmailSettings) => Promise<void>;
}): Promise<MigrationResult> {
  const { oldKey, newKey, getSettingsList, saveSetting } = params;
  
  if (!oldKey || !newKey || oldKey === newKey) {
    throw new Error('Distinct oldKey and newKey must be provided for migration.');
  }

  const items = await getSettingsList();
  const result: MigrationResult = {
    migratedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    errors: [],
  };

  for (const item of items) {
    const { branchId, data } = item;
    if (!data?.passwordEncrypted) {
      result.skippedCount++;
      continue;
    }

    try {
      // Decrypt in memory without storing/logging
      const decryptedPassword = decryptBranchEmailPassword(data.passwordEncrypted, branchId, oldKey);
      
      // Re-encrypt with new key bound to the branchId AAD
      const newEncrypted = encryptBranchEmailPassword(decryptedPassword, branchId, newKey);
      
      const updatedData: StoredBranchEmailSettings = {
        ...data,
        passwordEncrypted: newEncrypted,
        updatedAt: new Date().toISOString(),
      };

      await saveSetting(branchId, updatedData);
      result.migratedCount++;
    } catch (err: any) {
      result.failedCount++;
      // Log only the branchId and sanitized error category - NEVER the secret or raw payload
      result.errors.push(`Branch ${branchId}: failed to migrate password (invalid cipher or key mismatch)`);
    }
  }

  return result;
}
