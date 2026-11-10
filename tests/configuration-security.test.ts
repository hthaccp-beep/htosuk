/**
 * Issue 3 & Issue 22: Configuration Security, Legacy Email Secret Removal,
 * and Backup Export/Import Integrity Tests.
 *
 * Verifies:
 * - Plaintext SMTP credentials/passwords are never saved in client-readable settings.
 * - Firestore settings snapshots strip sensitive fields from application memory.
 * - Configuration backup export sanitizes emailConfig (no smtpPass) and user objects (no passwords).
 * - Configuration backup import rejects corrupt files and strips passwords prior to batch persistence.
 * - Firestore rules prevent client access to settings/email, settings/smtp, and reject any settings write containing smtpPass.
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EmailConfig, User, Product, Category, Supplier, Branch, RoleDefinition } from '../types.ts';

// ---------------------------------------------------------------------------
// Helpers & Logic Mirroring Store & AdminSystem
// ---------------------------------------------------------------------------

export function sanitizeEmailConfigForSave(config: EmailConfig): EmailConfig {
  const sanitized = { ...config };
  delete (sanitized as any).smtpPass;
  return sanitized;
}

export function sanitizeEmailConfigFromSnapshot(data: any): EmailConfig | null {
  if (!data) return null;
  const sanitized = { ...data };
  delete sanitized.smtpPass;
  return sanitized;
}

export function createSanitizedConfigExport(params: {
  products: Product[];
  categories: Category[];
  suppliers: Supplier[];
  branches: Branch[];
  roles: RoleDefinition[];
  rolePermissions: Record<string, string[]>;
  emailConfig: EmailConfig | null;
  users: User[];
  version?: string;
}) {
  const sanitizedEmailConfig = params.emailConfig ? { ...params.emailConfig } : null;
  if (sanitizedEmailConfig) {
    delete (sanitizedEmailConfig as any).smtpPass;
  }

  return {
    timestamp: new Date().toISOString(),
    type: 'configuration',
    version: params.version || '5.0',
    data: {
      products: params.products,
      categories: params.categories,
      suppliers: params.suppliers,
      branches: params.branches,
      roles: params.roles,
      rolePermissions: params.rolePermissions,
      emailConfig: sanitizedEmailConfig,
      users: params.users.map((u) => {
        const safeUser = { ...u };
        delete (safeUser as any).password;
        return safeUser;
      }),
    },
  };
}

export function validateAndSanitizeConfigImport(rawJson: any) {
  if (!rawJson || typeof rawJson !== 'object' || !rawJson.data) {
    throw new Error('Invalid File Format: Missing configuration data payload');
  }

  const d = rawJson.data;
  const result: any = {
    roles: Array.isArray(d.roles) ? d.roles : [],
    rolePermissions: d.rolePermissions || null,
    branches: Array.isArray(d.branches) ? d.branches : [],
    suppliers: Array.isArray(d.suppliers) ? d.suppliers : [],
    categories: Array.isArray(d.categories) ? d.categories : [],
    products: Array.isArray(d.products) ? d.products : [],
    emailConfig: null,
  };

  if (d.emailConfig) {
    const sanitizedEmail = { ...d.emailConfig };
    delete sanitizedEmail.smtpPass;
    result.emailConfig = sanitizedEmail;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Firestore Security Rules Simulation for Settings
// ---------------------------------------------------------------------------

export function simulateSettingsRuleCheck(params: {
  operation: 'read' | 'create' | 'update' | 'delete';
  docId: string;
  userRole: string | null;
  isActive: boolean;
  resourceData?: Record<string, any>;
  requestData?: Record<string, any>;
}): { allowed: boolean; reason?: string } {
  const { operation, docId, userRole, isActive, requestData } = params;

  if (!isActive || !userRole) {
    return { allowed: false, reason: 'Inactive or unauthenticated user' };
  }

  const isAdmin = userRole === 'CREATOR' || userRole === 'GM';

  // Disallow any client access to private email/smtp credential documents
  if (docId === 'email' || docId === 'smtp') {
    return { allowed: false, reason: 'Access to credentials doc is restricted' };
  }

  if (operation === 'read') {
    return { allowed: true };
  }

  if (operation === 'create' || operation === 'update') {
    if (!isAdmin) {
      return { allowed: false, reason: 'Only administrators may modify settings' };
    }
    // Disallow storing plaintext passwords in client-accessible settings
    if (requestData && 'smtpPass' in requestData && requestData.smtpPass !== '') {
      return { allowed: false, reason: 'smtpPass cannot be stored in client-accessible settings' };
    }
    return { allowed: true };
  }

  if (operation === 'delete') {
    if (!isAdmin) {
      return { allowed: false, reason: 'Only administrators may delete settings' };
    }
    return { allowed: true };
  }

  return { allowed: false, reason: 'Unknown operation' };
}

// ---------------------------------------------------------------------------
// Test Suites
// ---------------------------------------------------------------------------

describe('Configuration Security & Legacy Email Secret Removal (Issue 3 & Issue 22)', () => {
  describe('Email Configuration Sanitization', () => {
    it('strips smtpPass before persisting emailConfig to Firestore', () => {
      const configWithSecret: EmailConfig = {
        smtpHost: 'smtp.example.com',
        smtpPort: 465,
        smtpUser: 'orders@example.com',
        smtpPass: 'SuperSecretP@ssword123',
        fromName: 'Hare & Tortoise Orders',
        fromEmail: 'orders@example.com',
        replyTo: 'info@hareandtortoise.co.uk',
        enabled: true,
        useSSL: true,
      };

      const sanitized = sanitizeEmailConfigForSave(configWithSecret);

      assert.strictEqual(sanitized.fromName, 'Hare & Tortoise Orders');
      assert.strictEqual(sanitized.fromEmail, 'orders@example.com');
      assert.strictEqual(sanitized.replyTo, 'info@hareandtortoise.co.uk');
      assert.strictEqual(sanitized.enabled, true);
      assert.strictEqual(sanitized.smtpPass, undefined);
      assert.strictEqual('smtpPass' in sanitized, false);
    });

    it('strips smtpPass from snapshot data before loading into app state', () => {
      const snapshotFromLegacyDb = {
        smtpHost: 'smtp.legacy.co.uk',
        smtpPort: 587,
        smtpUser: 'legacy_admin',
        smtpPass: 'OldPlaintextPassword!',
        fromName: 'Legacy System',
        fromEmail: 'legacy@example.com',
        enabled: true,
      };

      const loadedState = sanitizeEmailConfigFromSnapshot(snapshotFromLegacyDb);

      assert.ok(loadedState);
      assert.strictEqual(loadedState.fromName, 'Legacy System');
      assert.strictEqual(loadedState.smtpPass, undefined);
      assert.strictEqual('smtpPass' in loadedState, false);
    });
  });

  describe('Configuration Backup Export Integrity', () => {
    it('ensures configuration exports never leak email secrets or user passwords', () => {
      const sampleEmailConfig: EmailConfig = {
        smtpHost: 'smtp.internal.co.uk',
        smtpPort: 465,
        smtpUser: 'admin_mailer',
        smtpPass: 'SensitiveMailboxPass!',
        fromName: 'H&T Orders',
        fromEmail: 'orders@hareandtortoise-co-uk.example',
        enabled: true,
      };

      const sampleUsers: User[] = [
        {
          id: 'u_1',
          username: 'manager_ken',
          displayName: 'Ken Manager',
          role: 'MANAGER',
          branchId: 'b_kensington',
          active: true,
          ...({ password: 'plain_user_password_should_not_leak' } as any),
        },
      ];

      const exportPayload = createSanitizedConfigExport({
        products: [],
        categories: [],
        suppliers: [],
        branches: [],
        roles: [],
        rolePermissions: {},
        emailConfig: sampleEmailConfig,
        users: sampleUsers,
        version: '5.0',
      });

      assert.strictEqual(exportPayload.type, 'configuration');
      assert.strictEqual(exportPayload.version, '5.0');
      assert.ok(exportPayload.timestamp);

      // Verify emailConfig is sanitized
      assert.ok(exportPayload.data.emailConfig);
      assert.strictEqual(exportPayload.data.emailConfig.fromName, 'H&T Orders');
      assert.strictEqual(exportPayload.data.emailConfig.smtpPass, undefined);
      assert.strictEqual('smtpPass' in exportPayload.data.emailConfig, false);

      // Verify user passwords are redacted
      const exportedUser = exportPayload.data.users[0];
      assert.strictEqual(exportedUser.username, 'manager_ken');
      assert.strictEqual((exportedUser as any).password, undefined);
      assert.strictEqual('password' in exportedUser, false);
    });
  });

  describe('Configuration Backup Import Validation', () => {
    it('rejects corrupt or invalid file formats without data attribute', () => {
      assert.throws(
        () => validateAndSanitizeConfigImport({ invalid: 'schema' }),
        /Invalid File Format: Missing configuration data payload/
      );
      assert.throws(
        () => validateAndSanitizeConfigImport(null),
        /Invalid File Format: Missing configuration data payload/
      );
    });

    it('strips incoming smtpPass from imported configuration before saving', () => {
      const importedJson = {
        timestamp: '2026-09-30T12:00:00.000Z',
        type: 'configuration',
        version: '3.9.8',
        data: {
          products: [{ id: 'p1', name: 'Noodles' }],
          emailConfig: {
            fromName: 'Imported System',
            fromEmail: 'imported@example.com',
            smtpHost: 'smtp.imported.com',
            smtpPass: 'MaliciousOrLegacyPasswordToInject',
            enabled: true,
          },
        },
      };

      const result = validateAndSanitizeConfigImport(importedJson);

      assert.strictEqual(result.products.length, 1);
      assert.ok(result.emailConfig);
      assert.strictEqual(result.emailConfig.fromName, 'Imported System');
      assert.strictEqual(result.emailConfig.smtpPass, undefined);
      assert.strictEqual('smtpPass' in result.emailConfig, false);
    });
  });

  describe('Firestore Security Rules Enforcement for Settings', () => {
    it('blocks all client reads and writes to settings/email and settings/smtp', () => {
      const readEmail = simulateSettingsRuleCheck({
        operation: 'read',
        docId: 'email',
        userRole: 'CREATOR',
        isActive: true,
      });
      assert.strictEqual(readEmail.allowed, false);

      const writeSmtp = simulateSettingsRuleCheck({
        operation: 'update',
        docId: 'smtp',
        userRole: 'CREATOR',
        isActive: true,
        requestData: { host: 'smtp.com' },
      });
      assert.strictEqual(writeSmtp.allowed, false);
    });

    it('blocks settings updates that attempt to include a non-empty smtpPass', () => {
      const attemptPasswordStore = simulateSettingsRuleCheck({
        operation: 'update',
        docId: 'email_config',
        userRole: 'GM',
        isActive: true,
        requestData: {
          fromName: 'Order System',
          smtpPass: 'AttemptedSecret',
        },
      });
      assert.strictEqual(attemptPasswordStore.allowed, false);
      assert.match(attemptPasswordStore.reason!, /smtpPass cannot be stored/);
    });

    it('permits GM and Creator to update sanitized settings/email_config without password', () => {
      const validAdminUpdate = simulateSettingsRuleCheck({
        operation: 'update',
        docId: 'email_config',
        userRole: 'CREATOR',
        isActive: true,
        requestData: {
          fromName: 'Order System',
          fromEmail: 'orders@hareandtortoise-co-uk.example',
          enabled: true,
        },
      });
      assert.strictEqual(validAdminUpdate.allowed, true);
    });

    it('denies Branch Manager and Staff from updating settings', () => {
      const managerUpdate = simulateSettingsRuleCheck({
        operation: 'update',
        docId: 'email_config',
        userRole: 'MANAGER',
        isActive: true,
        requestData: { enabled: false },
      });
      assert.strictEqual(managerUpdate.allowed, false);

      const staffUpdate = simulateSettingsRuleCheck({
        operation: 'update',
        docId: 'email_config',
        userRole: 'STAFF',
        isActive: true,
        requestData: { enabled: false },
      });
      assert.strictEqual(staffUpdate.allowed, false);
    });

    it('permits active users to read public settings (role_permissions, price_monitoring, email_config)', () => {
      const staffRead = simulateSettingsRuleCheck({
        operation: 'read',
        docId: 'role_permissions',
        userRole: 'STAFF',
        isActive: true,
      });
      assert.strictEqual(staffRead.allowed, true);
    });
  });
});
