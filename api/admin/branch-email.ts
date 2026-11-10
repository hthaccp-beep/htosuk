import {databaseErrorMessage,isDatabaseQuotaError} from '../../shared/database-errors.ts';
import { getAdmin } from '../firebase-admin.ts';
import {auditSuccessfulResponse} from '../../server/admin-audit.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import {activeProfile,verifySession} from '../../server/verified-identity.ts';

export const BRANCH_EMAIL_COLLECTION = '_branch_email_settings';
export const MANDATORY_EMAIL_CC = 'info@hareandtortoise.co.uk';

type Document = Record<string, unknown>;
export type EncryptedPassword = { iv: string; tag: string; ciphertext: string };
export type BranchEmailAccount = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  cc: string[];
  accountsCc?: string[];
};
export type StoredBranchEmailSettings = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  cc: string[];
  accountsCc?: string[];
  passwordEncrypted: EncryptedPassword;
  updatedBy: string;
  updatedAt: string;
};
export interface BranchEmailRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface BranchEmailResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): BranchEmailResponse;
  json(data: unknown): unknown;
  end(): unknown;
}
export interface BranchEmailSettingsDependencies {
  verifyToken(token: string): Promise<{ uid: string; email?: string; [key: string]: any }>;
  getUser(uid: string, identity?: any): Promise<Document | undefined>;
  getBranch(branchId: string): Promise<Document | undefined>;
  getSettings(branchId: string): Promise<unknown>;
  saveSettings(branchId: string, settings: StoredBranchEmailSettings): Promise<void>;
  env: Record<string, string | undefined>;
  now?: () => Date;
}

export class BranchEmailSettingsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BranchEmailSettingsError';
    this.status = status;
  }
}
const fail = (status: number, message: string): never => { throw new BranchEmailSettingsError(status, message); };
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const UNAVAILABLE = 'Branch email settings are unavailable. Ask an administrator to check the server configuration.';
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const CONTROL = /[\x00-\x1f\x7f]/;
const BODY_KEYS = new Set(['branchId', 'host', 'port', 'secure', 'user', 'password', 'cc', 'accountsCc']);
const AUTH_REJECTIONS = new Set([
  'auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired',
  'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
]);

export function assertBranchEmailId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\s/\\\x00-\x1f\x7f]/.test(value)) {
    return fail(400, 'Choose a valid branch.');
  }
  return value;
}

function singleEmail(value: unknown): string {
  if (typeof value !== 'string' || value.length > 254 || CONTROL.test(value) || !EMAIL.test(value.trim())) {
    return fail(400, 'Use one valid email address without a display name.');
  }
  const local = value.trim().split('@')[0];
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return fail(400, 'Use one valid email address without a display name.');
  }
  return value.trim();
}

function smtpFields(input: Document): Pick<StoredBranchEmailSettings, 'host' | 'port' | 'secure' | 'user'> {
  const host = typeof input.host === 'string' ? input.host.trim().toLowerCase() : '';
  const labels = host.split('.');
  if (!host || host.length > 253 || isIP(host) || labels.length < 2 ||
      host === 'localhost' || host.endsWith('.localhost') ||
      !/^[a-z]{2,63}$/i.test(labels[labels.length - 1]) ||
      labels.some(label => label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) {
    return fail(400, 'Use a public SMTP hostname, without a URL, IP address or port.');
  }
  if ((input.port !== 465 && input.port !== 587) || typeof input.secure !== 'boolean' ||
      input.secure !== (input.port === 465)) {
    return fail(400, 'Choose port 465 with SSL or port 587 with STARTTLS.');
  }
  return { host, port: input.port, secure: input.secure, user: singleEmail(input.user) };
}

export function normalizeBranchEmailCc(value: unknown, excludeOffice = true): string[] {
  if (typeof value !== 'string' || value.length > 4600 || CONTROL.test(value)) {
    return fail(400, 'Use a comma-separated list of additional CC email addresses.');
  }
  if (!value.trim()) return [];
  const entries = value.split(',').map(entry => singleEmail(entry).toLowerCase());
  const result = [...new Set(entries)].filter(entry => !excludeOffice || entry !== MANDATORY_EMAIL_CC);
  if (result.length > 18) return fail(400, 'Use at most 18 additional CC email addresses.');
  return result;
}

function encryptionKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return fail(503, UNAVAILABLE);
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded) return fail(503, UNAVAILABLE);
  return key;
}

function aad(branchId: string): Buffer {
  return Buffer.from(`ordersystem2027:branch-email:${assertBranchEmailId(branchId)}`, 'utf8');
}

export function encryptBranchEmailPassword(password: string, branchId: string, encodedKey: string | undefined): EncryptedPassword {
  const key = encryptionKey(encodedKey);
  if (typeof password !== 'string' || !password.trim() || password.length > 4096) {
    return fail(400, 'Enter an email password of at most 4096 characters.');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad(branchId));
  const ciphertext = Buffer.concat([cipher.update(password, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}

function strictBase64(value: unknown, maxBytes: number): Buffer {
  if (typeof value !== 'string' || !value.length || value.length > Math.ceil(maxBytes / 3) * 4 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return fail(503, UNAVAILABLE);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== value) return fail(503, UNAVAILABLE);
  return bytes;
}

export function decryptBranchEmailPassword(value: unknown, branchId: string, encodedKey: string | undefined): string {
  const key = encryptionKey(encodedKey);
  try {
    if (!object(value) || Object.keys(value).some(key => !['iv', 'tag', 'ciphertext'].includes(key))) return fail(503, UNAVAILABLE);
    const iv = strictBase64(value.iv, 12);
    const tag = strictBase64(value.tag, 16);
    const ciphertext = strictBase64(value.ciphertext, 16384);
    if (iv.length !== 12 || tag.length !== 16) return fail(503, UNAVAILABLE);
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(aad(branchId));
    decipher.setAuthTag(tag);
    const password = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    if (!password.trim() || password.length > 4096) return fail(503, UNAVAILABLE);
    return password;
  } catch (_) {
    return fail(503, UNAVAILABLE);
  }
}

function readMetadata(value: unknown) {
  if (!object(value)) return fail(503, UNAVAILABLE);
  const fields = smtpFields(value);
  if (value.cc !== undefined && (!Array.isArray(value.cc) || value.cc.some(item => typeof item !== 'string'))) {
    return fail(503, UNAVAILABLE);
  }
  const cc = value.cc === undefined ? [] : normalizeBranchEmailCc((value.cc as string[]).join(','));
  const accountsCc = value.accountsCc === undefined ? undefined : normalizeBranchEmailCc(Array.isArray(value.accountsCc) ? value.accountsCc.join(',') : null, false);
  return { ...fields, cc, ...(accountsCc ? {accountsCc} : {}) };
}

export function readBranchEmailAccount(value: unknown, branchId: string, encodedKey: string | undefined): BranchEmailAccount | undefined {
  encryptionKey(encodedKey);
  if (value === undefined || value === null) return undefined;
  try {
    const fields = readMetadata(value);
    if (!object(value)) return fail(503, UNAVAILABLE);
    const pass = decryptBranchEmailPassword(value.passwordEncrypted, branchId, encodedKey);
    return { ...fields, pass };
  } catch (_) {
    return fail(503, UNAVAILABLE);
  }
}

export function branchEmailAllowedOrigins(env: Record<string, string | undefined>): Set<string> {
  const origins = new Set(['https://ordersystem2027.vercel.app']);
  if (env.NODE_ENV !== 'production' && !env.VERCEL_ENV) {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:5173');
  }
  for (const candidate of [env.APP_ORIGIN, env.VERCEL_URL ? `https://${env.VERCEL_URL}` : undefined]) {
    if (!candidate) continue;
    try {
      const url = new URL(candidate);
      if (url.protocol === 'https:' && url.origin === candidate) {
        origins.add(url.origin);
      }
    } catch (_) { /* Invalid configured origins are not permitted. */ }
  }
  return origins;
}

export function isOriginAllowed(origin: string, env: Record<string, string | undefined>, hostHeader?: string | string[]): boolean {
  if (branchEmailAllowedOrigins(env).has(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = typeof hostHeader === 'string' ? hostHeader.trim() : undefined;
    if (host && (parsed.host === host || parsed.origin === `https://${host}` || parsed.origin === `http://${host}`)) {
      return true;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname.endsWith('.run.app') ||
      hostname.endsWith('.vercel.app') ||
      hostname.endsWith('.vercel.sh') ||
      hostname.endsWith('.googleusercontent.com') ||
      hostname.endsWith('.web.app') ||
      hostname.endsWith('.firebaseapp.com') ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1'
    ) {
      return true;
    }
  } catch (_) {}
  return false;
}

export function createBranchEmailSettingsHandler(deps: BranchEmailSettingsDependencies) {
  return async (req: BranchEmailRequest, res: BranchEmailResponse): Promise<unknown> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    try {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        if (typeof origin !== 'string' || !isOriginAllowed(origin, deps.env, req.headers.host)) {
          return fail(403, 'This origin is not allowed.');
        }
        res.setHeader('Access-Control-Allow-Origin', origin);
      }
      res.setHeader('Access-Control-Allow-Methods', 'GET,PUT,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return res.status(204).end();
      if (req.method !== 'GET' && req.method !== 'PUT') {
        res.setHeader('Allow', 'GET, PUT, OPTIONS');
        return fail(405, 'Method not allowed.');
      }
      const authHeader = req.headers.authorization || (req.headers as any)?.Authorization;
      if (typeof authHeader !== 'string' || !/^Bearer\s+\S+/i.test(authHeader.trim()) || authHeader.length > 8192) {
        return fail(401, 'Sign in to manage branch email settings.');
      }
      const rawToken = authHeader.trim().replace(/^Bearer\s+/i, '').trim();
      if (!rawToken) {
        return fail(401, 'Sign in to manage branch email settings.');
      }
      let uid: string;
      let identity: any;
      try {
        identity = await deps.verifyToken(rawToken);
        if (!identity?.uid) return fail(401, 'Sign in to manage branch email settings.');
        uid = identity.uid;
      } catch (error) {
        if (error instanceof BranchEmailSettingsError) throw error;
        if (object(error) && typeof error.code === 'string' && AUTH_REJECTIONS.has(error.code)) {
          return fail(401, 'Sign in to manage branch email settings.');
        }
        return fail(503, 'Sign-in could not be verified. Please try again.');
      }
      const profile = await deps.getUser(uid, identity);
      const userRole = String(profile?.role || '').toUpperCase();
      const isActive = profile?.active === true;

      if (!isActive || !['CREATOR', 'GM', 'ADMIN', 'ADMINISTRATOR'].includes(userRole)) {
        return fail(403, 'Only an active Creator or General Manager can manage branch email settings.');
      }
      let branchId: string;
      let body: Document | undefined;
      if (req.method === 'GET') {
        if (Object.keys(req.query || {}).some(key => key !== 'branchId')) return fail(400, 'Unexpected query fields.');
        branchId = assertBranchEmailId(req.query?.branchId);
      } else {
        if (!object(req.body) || Object.keys(req.body).some(key => !BODY_KEYS.has(key))) return fail(400, 'Unexpected or invalid email settings fields.');
        body = req.body;
        branchId = assertBranchEmailId(body.branchId);
      }
      const branch = await deps.getBranch(branchId);
      if (!branch) return fail(404, 'Branch not found.');
      let senderEmail: string;
      try { senderEmail = singleEmail(branch.email); } catch (_) {
        return fail(400, 'Save a single valid email address on this branch before configuring delivery.');
      }
      const key = deps.env.EMAIL_SETTINGS_ENCRYPTION_KEY;
      encryptionKey(key);
      const stored = await deps.getSettings(branchId);
      let metadata: ReturnType<typeof readMetadata> | undefined;
      let existing: BranchEmailAccount | undefined;
      if (stored !== undefined && stored !== null) {
        try { metadata = readMetadata(stored); } catch (_) { /* Offer a fresh form for invalid metadata. */ }
        try { existing = readBranchEmailAccount(stored, branchId, key); } catch (_) { /* Require a new password. */ }
      }
      if (req.method === 'GET') {
        const settings = metadata ? { ...metadata, hasPassword: !!existing } : null;
        return res.status(200).json({ settings, senderEmail, cc: MANDATORY_EMAIL_CC });
      }
      const fields = smtpFields(body!);
      if (fields.user.toLowerCase() !== senderEmail.toLowerCase()) return fail(400, 'The email username must exactly match this branch’s saved email address.');
      if (body!.password !== undefined && typeof body!.password !== 'string') return fail(400, 'The email password must be text.');
      if (typeof body!.password === 'string' && body!.password.length > 4096) return fail(400, 'The email password is too long.');
      const password = typeof body!.password === 'string' && body!.password.trim() ? body!.password : undefined;
      if (!password && (!existing || existing.host !== fields.host || existing.user !== fields.user)) {
        return fail(400, 'Enter a new password when first configuring email or changing the host or username.');
      }
      const cc = body!.cc === undefined ? metadata?.cc || [] : normalizeBranchEmailCc(body!.cc);
      const accountsCc = body!.accountsCc === undefined ? metadata?.accountsCc : normalizeBranchEmailCc(body!.accountsCc, false);
      const passwordEncrypted = password
        ? encryptBranchEmailPassword(password, branchId, key)
        : (stored as StoredBranchEmailSettings).passwordEncrypted;
      await deps.saveSettings(branchId, {
        ...fields, cc, ...(accountsCc ? {accountsCc} : {}), passwordEncrypted, updatedBy: uid, updatedAt: (deps.now || (() => new Date()))().toISOString(),
      });
      return res.status(200).json({ success: true, settings: { ...fields, cc, ...(accountsCc ? {accountsCc} : {}), hasPassword: true }, senderEmail, cc: MANDATORY_EMAIL_CC });
    } catch (error) {
      if (error instanceof BranchEmailSettingsError) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: databaseErrorMessage(error,'Branch email settings could not be processed. Please try again.'), ...(isDatabaseQuotaError(error)?{code:'DATABASE_QUOTA_EXCEEDED'}:{}) });
    }
  };
}

// Lazy, safe Firebase Admin initialization


const getSettings = async (branchId: string): Promise<unknown> => {
  const { db } = getAdmin();
  const snapshot = await db.collection(BRANCH_EMAIL_COLLECTION).doc(assertBranchEmailId(branchId)).get();
  return snapshot.exists ? snapshot.data() : undefined;
};

/** Server-only accessor. Never return this account object from an HTTP handler. */
export async function getBranchEmailAccount(branchId: string): Promise<BranchEmailAccount | undefined> {
  const key = process.env.EMAIL_SETTINGS_ENCRYPTION_KEY;
  if (!key) {
    throw new BranchEmailSettingsError(503, UNAVAILABLE);
  }
  readBranchEmailAccount(undefined, branchId, key); // Fail before database access if the server key is unavailable.
  return readBranchEmailAccount(await getSettings(branchId), branchId, key);
}

const handler = createBranchEmailSettingsHandler({
  verifyToken: token => verifySession(getAdmin().auth,token),
  getUser: uid => activeProfile(getAdmin().db,uid),
  getBranch: async branchId => {
    const snapshot=await getAdmin().db.collection('branches').doc(branchId).get();
    return snapshot.exists?snapshot.data():undefined;
  },
  getSettings,
  saveSettings: async (branchId, settings) => {
    await getAdmin().db.collection(BRANCH_EMAIL_COLLECTION).doc(branchId).set(settings);
  },
  env: {
    ...process.env,
    EMAIL_SETTINGS_ENCRYPTION_KEY: process.env.EMAIL_SETTINGS_ENCRYPTION_KEY,
  },
});

export { handler as defaultBranchEmailHandler };

export default async function branchEmailSettings(req: VercelRequest, res: VercelResponse) {
  auditSuccessfulResponse(req,res,'BRANCH');
  try {
    return await handler(req, res);
  } catch (error: any) {
    console.error('Branch Email Settings Unhandled Exception:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error?.message || 'Branch email settings server error.' });
    }
  }
}
