import {checkUserActionPermission} from './order-authorization.ts';
import {createHash} from 'node:crypto';
import { renderAuthoritativeOrderEmailHtml } from './email-outbox-service.ts';

/** The email boundary is independent of Firebase/SMTP so tests never need to send mail. */
type Document = Record<string, unknown>;
type Purpose = 'order' | 'resend' | 'delivery' | 'credit-claim' | 'price-alert';
export interface EmailRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}
export interface EmailResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): EmailResponse;
  json(data: unknown): unknown;
  end(): unknown;
}
export interface Mail {
  from: { name: string; address: string };
  to: string[];
  cc: string[];
  replyTo?: string;
  subject: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
  disableFileAccess: true;
  disableUrlAccess: true;
}
export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: { user: string; pass: string };
  tls: { rejectUnauthorized: true; minVersion: 'TLSv1.2' };
  connectionTimeout: number;
  greetingTimeout: number;
  socketTimeout: number;
  disableFileAccess: true;
  disableUrlAccess: true;
}
export interface EmailDependencies {
  verifyToken(token: string): Promise<{ uid: string }>;
  getUser(uid: string): Promise<Document | undefined>;
  getBranch(id: string): Promise<Document | undefined>;
  getSupplier(id: string): Promise<Document | undefined>;
  getOrder(id: string): Promise<Document | undefined>;
  getBranchEmailAccount(id: string): Promise<Document | undefined>;
  getRolePermissions?(): Promise<Record<string,string[]> | undefined>;
  reserveSend(uid: string): Promise<boolean>;
  deliver(mail: Mail, config: SmtpConfig): Promise<{ accepted: string[]; rejected: string[] }>;
  env: Record<string, string | undefined>;
}

class Rejection extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const reject = (status: number, message: string): never => { throw new Rejection(status, message); };
const object = (value: unknown): value is Document => !!value && typeof value === 'object' && !Array.isArray(value);
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 2.5 * 1024 * 1024;
const PURPOSES = new Set(['order', 'resend', 'delivery', 'credit-claim', 'price-alert']);
const KEYS = new Set(['purpose', 'branchId', 'supplierId', 'orderId', 'orderVersion', 'version', 'routeKey', 'to', 'cc', 'replyTo', 'subject', 'html', 'attachments']);
const AUTH_REJECTIONS = new Set([
  'auth/argument-error', 'auth/invalid-argument', 'auth/invalid-id-token', 'auth/id-token-expired',
  'auth/id-token-revoked', 'auth/user-disabled', 'auth/user-not-found',
]);

function id(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128 || /[\s/\\\x00-\x1f\x7f]/.test(value)) {
    reject(400, 'A valid order, branch or supplier reference is required.');
  }
  return value as string;
}

function addresses(value: unknown, required = false): string[] {
  if (value === undefined || value === '') {
    if (required) reject(400, 'Choose an email address saved on the supplier or branch.');
    return [];
  }
  if (typeof value !== 'string' || value.length > 5200 || /[\r\n\x00-\x1f\x7f]/.test(value)) {
    reject(400, 'Use comma-separated email addresses without display names.');
  }
  const result = (value as string).split(',').map(item => item.trim().toLowerCase());
  const email = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
  if (result.length > 20 || result.some(item => !item || item.length > 254 || !email.test(item))) {
    reject(400, 'One or more email addresses are invalid. Check the saved contact details.');
  }
  return [...new Set(result)];
}

function savedContacts(document: Document): Set<string> {
  const result = new Set<string>();
  for (const field of ['email', 'contactEmail']) {
    const raw = document[field];
    if (!raw) continue;
    for (const address of addresses(raw)) result.add(address);
  }
  return result;
}

function attachmentList(value: unknown): Mail['attachments'] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 3) reject(400, 'Use at most three PDF or image attachments.');
  let total = 0;
  return (value as unknown[]).map(item => {
    if (!object(item) || Object.keys(item).some(key => !['filename', 'content', 'encoding'].includes(key))) {
      return reject(400, 'Only encoded PDF or image attachments are supported.');
    }
    const { filename, content, encoding } = item;
    if (typeof filename !== 'string' || !filename.trim() || filename.length > 160 || /[\/\\\x00-\x1f\x7f<>:"|?*]/.test(filename) || filename.startsWith('.')) {
      return reject(400, 'An attachment has an invalid filename.');
    }
    if (encoding !== 'base64' || typeof content !== 'string' || !content.length) {
      return reject(400, 'An attachment is not a valid encoded PDF or image.');
    }
    if (content.length > Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4) reject(413, 'Attachments must total 2.5 MB or less.');
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content)) {
      return reject(400, 'An attachment contains invalid encoding.');
    }
    const bytes = Buffer.from(content, 'base64');
    total += bytes.length;
    if (total > MAX_ATTACHMENT_BYTES) reject(413, 'Attachments must total 2.5 MB or less.');
    if (bytes.toString('base64') !== content) reject(400, 'An attachment contains invalid encoding.');
    const extension = filename.toLowerCase().split('.').pop();
    let contentType: string | undefined;
    if (bytes.subarray(0, 5).toString('ascii') === '%PDF-' && extension === 'pdf') contentType = 'application/pdf';
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && extension === 'png') contentType = 'image/png';
    if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && ['jpg', 'jpeg'].includes(extension || '')) contentType = 'image/jpeg';
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' && extension === 'webp') contentType = 'image/webp';
    if (!contentType) return reject(400, 'An attachment must be a PDF, PNG, JPEG or WebP file with the matching filename.');
    return { filename, content: bytes, contentType };
  });
}

function smtpConfig(env: EmailDependencies['env']): { config: SmtpConfig; from: string } {
  const host = env.SMTP_HOST?.trim();
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  const port = Number(env.SMTP_PORT || '465');
  let secureValue = env.SMTP_SECURE;
  if (secureValue !== undefined && !['true', 'false'].includes(secureValue)) {
    if (!env.SMTP_FROM_NAME) {
      env.SMTP_FROM_NAME = secureValue;
    }
    secureValue = port === 465 ? 'true' : 'false';
  }
  if (!host || !user || !pass || /[\s/:\\]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 ||
    (secureValue !== undefined && !['true', 'false'].includes(secureValue))) {
    return reject(503, 'Email is not configured on the server. Ask an administrator to check the server email settings.');
  }
  let from: string[];
  try { from = addresses(env.SMTP_FROM_EMAIL || user, true); }
  catch { return reject(503, 'The server sender email address is not configured correctly.'); }
  if (from.length !== 1) return reject(503, 'The server must use one sender email address.');
  const secure = secureValue === undefined ? port === 465 : secureValue === 'true';
  return {
    from: from[0],
    config: {
      host, port, secure, requireTLS: !secure, auth: { user, pass },
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      disableFileAccess: true, disableUrlAccess: true,
    },
  };
}

export function branchSmtpConfig(env: EmailDependencies['env'], account: Document | undefined, branch: Document): { config: SmtpConfig; from: string } {
  let branchAddresses: string[];
  try { branchAddresses = addresses(branch.email, true); }
  catch { return reject(503, 'This branch needs one valid saved email address before it can send orders.'); }
  if (branchAddresses.length !== 1) return reject(503, 'This branch needs one saved sender email address.');
  if (!object(account)) {
    return reject(503, 'The mail account for this branch is not configured. Ask an administrator to set it up in Administration → Branches → Email settings.');
  }
  if (typeof account.user !== 'string' || account.user.trim().toLowerCase() !== branchAddresses[0] ||
    typeof account.pass !== 'string' || !account.pass ||
    (account.host !== undefined && typeof account.host !== 'string') ||
    (account.port !== undefined && (!Number.isInteger(account.port) || Number(account.port) < 1 || Number(account.port) > 65535)) ||
    (account.secure !== undefined && typeof account.secure !== 'boolean')) {
    return reject(503, 'The server mail account must match this branch email address and have valid login settings.');
  }
  // Missing branch credentials never fall back to another branch or the shared mailbox.
  return smtpConfig({
    ...env,
    SMTP_USER: account.user,
    SMTP_PASS: account.pass,
    SMTP_FROM_EMAIL: branchAddresses[0],
    SMTP_HOST: account.host === undefined ? env.SMTP_HOST : String(account.host),
    SMTP_PORT: account.port === undefined ? env.SMTP_PORT : String(account.port),
    SMTP_SECURE: account.secure === undefined ? (account.port === undefined ? env.SMTP_SECURE : undefined) : String(account.secure),
  });
}

/** Safe public routing only: never return the account or transport credentials. */
export function orderEmailRouting(branch: Document, supplier: Document, account: Document | undefined, env: EmailDependencies['env'], recipients?: string[]) {
  const {from}=branchSmtpConfig(env,account,branch);
  const to=recipients || addresses(supplier.email || supplier.contactEmail,true);
  const savedCc=account?.cc;
  if(savedCc!==undefined && (!Array.isArray(savedCc)||savedCc.some(a=>typeof a!=='string'))) return reject(503,'Check the saved branch CC addresses.');
  const extra=addresses(savedCc===undefined?undefined:(savedCc as string[]).join(','));
  const cc=[...new Set([from,'info@hareandtortoise.co.uk',...extra])].filter(a=>!to.includes(a));
  if(to.length+cc.length>20) return reject(400,'Use at most 20 recipients per email.');
  const route={fromName:String(branch.name||'HTOS').replace(/[\r\n\x00-\x1f\x7f]/g,'').slice(0,120),from,to,cc,replyTo:from};
  return {...route,routeKey:createHash('sha256').update(JSON.stringify(route)).digest('hex'),ready:true};
}

function allowedOrigins(env: EmailDependencies['env']): Set<string> {
  const origins = new Set(['https://ordersystem2027.vercel.app']);
  for (const input of [env.APP_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`]) {
    if (!input) continue;
    try {
      const url = new URL(input);
      if (url.protocol === 'https:' && url.origin === input) origins.add(url.origin);
    } catch { /* Invalid configuration never broadens access. */ }
  }
  if (env.NODE_ENV !== 'production' && !env.VERCEL_ENV) {
    origins.add('http://localhost:3000');
    origins.add('http://localhost:5173');
  }
  return origins;
}

export function isEmailOriginAllowed(origin: string, env: EmailDependencies['env'], hostHeader?: string | string[]): boolean {
  if (allowedOrigins(env).has(origin)) return true;
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
      (env.NODE_ENV !== 'production' && !env.VERCEL_ENV && (hostname === 'localhost' || hostname === '127.0.0.1'))
    ) {
      return true;
    }
  } catch (_) {}
  return false;
}

export function createEmailHandler(deps: EmailDependencies) {
  return async (req: EmailRequest, res: EmailResponse): Promise<unknown> => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    try {
      const origin = req.headers.origin;
      if (origin !== undefined) {
        if (typeof origin !== 'string' || !isEmailOriginAllowed(origin, deps.env, req.headers.host)) reject(403, 'This website is not allowed to use the email service.');
        res.setHeader('Access-Control-Allow-Origin', origin as string);
      }
      res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.method === 'OPTIONS') return res.status(204).end();
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return reject(405, 'Method not allowed.');
      }
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [^\s]{1,8192}$/.test(authorization)) reject(401, 'Sign in again before sending email.');
      let uid: string;
      try { uid = (await deps.verifyToken((authorization as string).slice(7))).uid; }
      catch (error) {
        if (object(error) && typeof error.code === 'string' && AUTH_REJECTIONS.has(error.code)) reject(401, 'Your session is no longer valid. Sign in again.');
        return reject(503, 'Account verification is temporarily unavailable. Please try again later.');
      }
      if (!uid) return reject(401, 'Sign in again before sending email.');
      const user = await deps.getUser(uid);
      const userRole = String(user?.role || '').toUpperCase();
      if (!user || user.active !== true || !['CREATOR', 'GM', 'MANAGER', 'STAFF', 'ADMIN', 'ADMINISTRATOR'].includes(userRole)) {
        return reject(403, 'An active account with email access is required. Contact an administrator.');
      }
      const body = req.body;
      if (!object(body)) return reject(400, 'A JSON email request is required.');
      if (Buffer.byteLength(JSON.stringify(body), 'utf8') > MAX_BODY_BYTES) reject(413, 'The email request is too large. Reduce the attachments.');
      if (Object.keys(body).some(key => !KEYS.has(key))) reject(400, 'Unsupported email fields. Refresh the app before trying again.');
      if (typeof body.purpose !== 'string' || !PURPOSES.has(body.purpose)) reject(400, 'Choose a supported email workflow.');
      const purpose = body.purpose as Purpose;
      if (typeof body.subject !== 'string' || !body.subject.trim() || body.subject.length > 200 || /[\r\n\x00-\x1f\x7f]/.test(body.subject)) reject(400, 'The email subject is invalid or too long.');
      if (typeof body.html !== 'string' || !body.html.trim() || Buffer.byteLength(body.html, 'utf8') > 200 * 1024) reject(400, 'The email content is empty or too large.');
      const attachments = attachmentList(body.attachments);
      const globalAccess = userRole === 'CREATOR' || userRole === 'GM' || userRole === 'ADMIN' || userRole === 'ADMINISTRATOR' || user.allBranches === true;
      let branchId: string | undefined;
      let supplierId: string;
      let storedOrder: Document | undefined;
      if (purpose === 'order') {
        if (body.orderId !== undefined) {
          storedOrder = await deps.getOrder(id(body.orderId));
          if (!storedOrder || (storedOrder.status !== 'PLACED' && storedOrder.status !== 'PENDING')) {
            return reject(403, 'A valid saved order you can access is required.');
          }
          branchId = id(storedOrder.branchId);
          supplierId = id(storedOrder.supplierId);
          if ((body.branchId !== undefined && body.branchId !== branchId) || (body.supplierId !== undefined && body.supplierId !== supplierId)) {
            reject(400, 'The email references do not match the saved order.');
          }
        } else {
          branchId = id(body.branchId);
          supplierId = id(body.supplierId);
        }
      } else if (purpose === 'price-alert') {
        if (body.orderId !== undefined || body.to !== undefined || body.cc !== undefined || body.replyTo !== undefined) reject(400, 'Price alerts use the server-configured recipient.');
        supplierId = id(body.supplierId);
        branchId = typeof user.branchId === 'string' && user.branchId ? id(user.branchId) : undefined;
        if (body.branchId !== undefined && body.branchId !== branchId) reject(403, 'You cannot send email for another branch.');
      } else {
        storedOrder = await deps.getOrder(id(body.orderId));
        if (!storedOrder || (storedOrder.status !== 'PLACED' && storedOrder.status !== 'PENDING')) return reject(403, 'A placed order you can access is required.');
        branchId = id(storedOrder.branchId);
        supplierId = id(storedOrder.supplierId);
        if ((body.branchId !== undefined && body.branchId !== branchId) || (body.supplierId !== undefined && body.supplierId !== supplierId)) reject(400, 'The email references do not match the saved order.');
      }
      const [branch, supplier] = await Promise.all([
        branchId ? deps.getBranch(branchId) : Promise.resolve(undefined),
        deps.getSupplier(supplierId),
      ]);
      if (!supplier || supplier.active !== true || (branchId && (!branch || branch.active !== true))) return reject(403, 'The supplier and branch must be active before sending email.');
      if (!globalAccess) {
        const userBranchId = typeof user.branchId === 'string' && user.branchId ? id(user.branchId) : undefined;
        const isBranchAuthorized = Boolean(
          (branchId && userBranchId && branchId === userBranchId) ||
          user.allBranches === true ||
          (Array.isArray(user.branchIds) && branchId ? user.branchIds.includes(branchId) : false)
        );
        const receivingBranch = Boolean(userBranchId && supplier.linkedBranchId === userBranchId);
        const orderingBranch = isBranchAuthorized;
        const permitted = purpose === 'delivery' ? receivingBranch : purpose === 'credit-claim' ? orderingBranch || receivingBranch : orderingBranch;
        if (!permitted) reject(403, 'Your account cannot send this email for the selected branch.');
        if (userBranchId && userBranchId !== branchId) {
          const ownBranch = await deps.getBranch(userBranchId);
          if (!ownBranch || ownBranch.active !== true) reject(403, 'Your branch must be active before sending email.');
        }
      }
      const isOrderEmail = purpose === 'order' || purpose === 'resend';
      if(isOrderEmail&&!checkUserActionPermission({...user,id:uid} as any,'submit_orders',await deps.getRolePermissions?.())) reject(403,'Your role cannot send order emails.');
      const branchAccount = isOrderEmail ? await deps.getBranchEmailAccount(branchId!) : undefined;
      const { config, from } = isOrderEmail ? branchSmtpConfig(deps.env, branchAccount, branch!) : smtpConfig(deps.env);
      let to: string[];
      let cc: string[] = [];
      let replyTo: string | undefined;
      if (purpose === 'price-alert') {
        try { to = addresses(deps.env.SMTP_ALERT_TO, true); }
        catch { return reject(503, 'Price alert recipients are not configured on the server.'); }
      } else {
        const supplierContacts = savedContacts(supplier);
        const branchContacts = savedContacts(branch!);
        const allContacts = new Set([...supplierContacts, ...branchContacts]);
        const primaryContacts = purpose === 'delivery' ? branchContacts : supplierContacts;
        to = addresses(body.to, true);
        cc = addresses(body.cc);
        const replies = addresses(body.replyTo);
        if (to.some(address => !primaryContacts.has(address)) || [...cc, ...replies].some(address => !allContacts.has(address))) {
          reject(403, 'Use an email address saved on this supplier or branch. Ask an administrator to update the contact details first.');
        }
        if (replies.length > 1) reject(400, 'Use one saved contact for the reply address.');
        replyTo = replies[0];
        cc = cc.filter(address => !to.includes(address));
        if (isOrderEmail) {
          const route=orderEmailRouting(branch!,supplier,branchAccount,deps.env,to);
          if(body.routeKey!==undefined && body.routeKey!==route.routeKey) reject(409,'Email recipients changed. Review the saved order email again before sending.');
          cc=route.cc;
          replyTo=route.replyTo;
        }
        if (to.length + cc.length > 20) reject(400, 'Use at most 20 recipients per email.');
      }
      const name = String((isOrderEmail ? branch?.name : deps.env.SMTP_FROM_NAME || (purpose === 'delivery' ? supplier.name : branch?.name)) || 'Order System').replace(/[\r\n\x00-\x1f\x7f]/g, '').slice(0, 120);
      if (!await deps.reserveSend(uid)) {
        res.setHeader('Retry-After', '60');
        return reject(429, 'Too many emails were requested. Wait a minute before trying again.');
      }
      try {
        const renderedHtml = (isOrderEmail && storedOrder)
          ? renderAuthoritativeOrderEmailHtml(storedOrder as any, branch as any, supplier as any)
          : (body.html as string);
        const mail: Mail = { from: { name, address: from }, to, cc, replyTo, subject: body.subject as string, html: renderedHtml, attachments, disableFileAccess: true, disableUrlAccess: true };
        const result = await deps.deliver(mail, config);
        const accepted = new Set(result.accepted.map(address => address.toLowerCase()));
        if (result.rejected.length || [...to, ...cc].some(address => !accepted.has(address))) {
          return reject(502, 'The mail server did not accept every recipient. Some may have received the email; check before resending.');
        }
      } catch (error) {
        if (error instanceof Rejection) throw error;
        return reject(502, 'The mail server could not confirm this email. Check whether it arrived before trying again.');
      }
      return res.status(200).json({ success: true });
    } catch (error) {
      if (error instanceof Rejection) return res.status(error.status).json({ error: error.message });
      return res.status(503).json({ error: 'The email service is temporarily unavailable. Please try again later.' });
    }
  };
}
