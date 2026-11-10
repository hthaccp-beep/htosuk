import type { AuditLogEntry } from '../types.ts';

const SENSITIVE_KEYWORDS = [
  'pass',
  'secret',
  'token',
  'auth',
  'private_key',
];

/**
 * Recursively sanitizes audit details to remove secrets and passwords.
 */
export function sanitizeAuditDetails(details: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};

  for (const [key, val] of Object.entries(details)) {
    const keyLower = key.toLowerCase();
    const isSensitive = SENSITIVE_KEYWORDS.some(keyword => keyLower.includes(keyword));

    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (Array.isArray(val)) {
      result[key] = val.map(item => item && typeof item === 'object' ? sanitizeAuditDetails(item) : item);
    } else if (val && typeof val === 'object') {
      result[key] = sanitizeAuditDetails(val);
    } else {
      result[key] = val;
    }
  }

  return result;
}

/**
 * Creates an immutable AuditLogEntry for recording administrative or financial events.
 */
export function createAuditLogEntry(params: {
  userId: string;
  userEmail: string;
  userName: string;
  action: string;
  entityType: AuditLogEntry['entityType'];
  entityId: string;
  branchId?: string;
  details: Record<string, any>;
  ipAddress?: string;
}): AuditLogEntry {
  if (!params.userId || !params.userId.trim()) {
    throw new Error('Audit log requires a valid userId');
  }
  if (!params.action || !params.action.trim()) {
    throw new Error('Audit log requires a valid action descriptor');
  }
  if (!params.entityId || !params.entityId.trim()) {
    throw new Error('Audit log requires a valid entityId');
  }

  return {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    timestamp: new Date().toISOString(),
    userId: params.userId.trim(),
    userEmail: params.userEmail.trim(),
    userName: params.userName.trim(),
    action: params.action.trim().toUpperCase(),
    entityType: params.entityType,
    entityId: params.entityId.trim(),
    branchId: params.branchId,
    details: sanitizeAuditDetails(params.details),
    ipAddress: params.ipAddress,
  };
}
