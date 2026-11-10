import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmailHandler } from '../server/email-service.ts';

// Every dependency is a local mock. These tests never initialize Firebase,
// Nodemailer, fetch, sockets, or any production provider.
const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpg = Buffer.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 255, 217]);
const attachment = (filename = 'Order.pdf', content = pdf) => ({
  filename, content: content.toString('base64'), encoding: 'base64',
});

function harness() {
  const state = {
    user: { id: 'u1', active: true, role: 'STAFF', branchId: 'b1', displayName: 'Mock staff' } as Record<string, unknown> | undefined,
    branches: {
      b1: { id: 'b1', active: true, name: 'Ordering branch', email: 'branch@example.test', contactEmail: 'manager@example.test' },
      b2: { id: 'b2', active: true, name: 'Receiving branch', email: 'receiver@example.test', contactEmail: 'receiving-manager@example.test' },
    } as Record<string, Record<string, unknown> | undefined>,
    suppliers: {
      s1: { id: 's1', active: true, name: 'Trusted supplier', email: 'supplier@example.test', contactEmail: 'accounts@example.test', linkedBranchId: 'b2' },
      s2: { id: 's2', active: true, name: 'Other supplier', email: 'other-supplier@example.test' },
    } as Record<string, Record<string, unknown> | undefined>,
    orders: { o1: { id: 'o1', status: 'PLACED', branchId: 'b1', supplierId: 's1' } } as Record<string, Record<string, unknown> | undefined>,
    accounts: {
      b1: { user: 'branch@example.test', pass: 'mock-branch-one-password' },
      b2: { user: 'receiver@example.test', pass: 'mock-branch-two-password' },
    } as Record<string, Record<string, unknown> | undefined>,
    env: {
      NODE_ENV: 'production', APP_ORIGIN: 'https://orders.example.test',
      SMTP_HOST: 'smtp.example.test', SMTP_PORT: '465', SMTP_SECURE: 'true',
      SMTP_USER: 'mailer@example.test', SMTP_PASS: 'private-server-only-password',
      SMTP_FROM_EMAIL: 'orders@example.test', SMTP_FROM_NAME: 'Trusted order system',
      SMTP_ALERT_TO: 'operations@example.test',
    } as Record<string, string | undefined>,
    verifiedToken: 'valid-token', authError: undefined as unknown,
    reservation: true, reservationError: undefined as unknown,
    deliveryError: undefined as unknown,
    deliveryResult: undefined as { accepted: string[]; rejected: string[] } | undefined,
    userReadError: undefined as unknown,
    accountReadError: undefined as unknown,
  };
  const calls = { verify: [] as string[], user: [] as string[], branch: [] as string[], supplier: [] as string[], order: [] as string[], account: [] as string[], reserve: [] as string[], deliveries: [] as { mail: any; config: any }[] };
  const handler = createEmailHandler({
    env: state.env,
    async verifyToken(token: string) {
      calls.verify.push(token);
      if (state.authError) throw state.authError;
      return { uid: 'u1' };
    },
    async getUser(uid: string) { calls.user.push(uid); if (state.userReadError) throw state.userReadError; return state.user; },
    async getBranch(id: string) { calls.branch.push(id); return state.branches[id]; },
    async getSupplier(id: string) { calls.supplier.push(id); return state.suppliers[id]; },
    async getOrder(id: string) { calls.order.push(id); return state.orders[id]; },
    async getBranchEmailAccount(id: string) { calls.account.push(id); if (state.accountReadError) throw state.accountReadError; return state.accounts[id]; },
    async reserveSend(uid: string) {
      calls.reserve.push(uid);
      if (state.reservationError) throw state.reservationError;
      return state.reservation;
    },
    async deliver(mail: any, config: any) {
      calls.deliveries.push({ mail, config });
      if (state.deliveryError) throw state.deliveryError;
      return state.deliveryResult ?? { accepted: [...mail.to, ...mail.cc], rejected: [] };
    },
  });
  const baseBody = { purpose: 'order', branchId: 'b1', supplierId: 's1', to: 'supplier@example.test', cc: 'branch@example.test', replyTo: 'manager@example.test', subject: 'Order 123', html: '<p>Synthetic order only</p>', attachments: [attachment()] };
  async function request(options: { body?: unknown; headers?: Record<string, string | string[] | undefined>; method?: string } = {}) {
    const response = { code: 200, headers: {} as Record<string, string>, data: undefined as any, ended: false };
    const res = {
      setHeader(name: string, value: string) { response.headers[name.toLowerCase()] = value; return res; },
      status(code: number) { response.code = code; return res; },
      json(data: unknown) { response.data = data; return res; },
      end() { response.ended = true; return res; },
    };
    await handler({ method: options.method ?? 'POST', headers: options.headers ?? { authorization: 'Bearer valid-token' }, body: Object.prototype.hasOwnProperty.call(options, 'body') ? options.body : baseBody }, res);
    return response;
  }
  async function send(patch: Record<string, unknown> = {}) { return request({ body: { ...baseBody, ...patch } }); }
  return { state, calls, baseBody, request, send };
}

function noSend(h: ReturnType<typeof harness>) {
  assert.equal(h.calls.deliveries.length, 0, 'must not call SMTP for a denied request');
  assert.equal(h.calls.reserve.length, 0, 'invalid requests must not consume send quota');
}
function storedBody(h: ReturnType<typeof harness>, purpose: string, patch: Record<string, unknown> = {}) {
  const { branchId, supplierId, ...rest } = h.baseBody;
  return { ...rest, purpose, orderId: 'o1', ...patch };
}

test('POST without a bearer token is rejected before data/SMTP work', async () => {
  const h = harness(); const r = await h.request({ headers: {} });
  assert.equal(r.code, 401); noSend(h); assert.deepEqual(h.calls.user, []); assert.deepEqual(h.calls.order, []);
});

for (const header of ['Basic abc', 'Bearer ', ['Bearer valid-token', 'Bearer other-token']]) {
  test(`malformed authorization is rejected: ${JSON.stringify(header)}`, async () => {
    const h = harness(); const r = await h.request({ headers: { authorization: header } });
    assert.equal(r.code, 401); noSend(h);
  });
}
for (const code of ['auth/id-token-expired', 'auth/id-token-revoked', 'auth/argument-error']) {
  test(`invalid Firebase credential fails closed (${code})`, async () => {
    const h = harness(); h.state.authError = Object.assign(new Error('sensitive auth internals'), { code });
    const r = await h.send(); assert.equal(r.code, 401); noSend(h);
    assert.doesNotMatch(JSON.stringify(r.data), /sensitive auth internals/);
  });
}
test('authentication infrastructure errors do not expose their cause', async () => {
  const h = harness(); h.state.authError = Object.assign(new Error('private-key detail'), { code: 'auth/internal-error' });
  const r = await h.send(); assert.equal(r.code, 503); noSend(h); assert.doesNotMatch(JSON.stringify(r.data), /private-key detail/);
});
for (const user of [undefined, { role: 'STAFF', branchId: 'b1', active: false }, { role: 'STAFF', branchId: 'b1' }, { role: 'STAFF', branchId: 'b1', active: 'true' }, { role: 'CUSTOM_OWNER', branchId: 'b1', active: true }]) {
  test(`missing/inactive/unrecognized profile is denied: ${JSON.stringify(user)}`, async () => {
    const h = harness(); h.state.user = user; const r = await h.send(); assert.equal(r.code, 403); noSend(h);
  });
}
test('profile lookup failure is generic and does not send', async () => {
  const h = harness(); h.state.userReadError = new Error('database-secret-detail');
  const r = await h.send(); assert.equal(r.code, 503); noSend(h); assert.doesNotMatch(JSON.stringify(r.data), /database-secret-detail/);
});

test('initial order uses verified identity and current saved contacts without requiring an existing order', async () => {
  const h = harness(); const r = await h.send(); assert.equal(r.code, 200);
  assert.deepEqual(h.calls.verify, ['valid-token']); assert.deepEqual(h.calls.user, ['u1']);
  assert.deepEqual(h.calls.order, []); assert.deepEqual(h.calls.reserve, ['u1']);
  assert.equal(h.calls.deliveries.length, 1);
  assert.deepEqual(h.calls.deliveries[0].mail.to, ['supplier@example.test']);
});
for (const role of ['STAFF', 'MANAGER']) {
  test(`${role} cannot place another branch's order`, async () => {
    const h = harness(); h.state.user!.role = role; const r = await h.send({ branchId: 'b2' }); assert.equal(r.code, 403); noSend(h);
  });
}
for (const role of ['CREATOR', 'GM']) {
  test(`${role} may place an order for another active branch`, async () => {
    const h = harness(); h.state.user!.role = role;
    const r = await h.send({ branchId: 'b2', cc: 'receiver@example.test', replyTo: 'receiving-manager@example.test' }); assert.equal(r.code, 200);
    assert.equal(h.calls.deliveries.length, 1);
  });
}
for (const entity of ['branch', 'supplier']) {
  for (const variant of ['missing', 'inactive', 'no-active-flag']) {
    test(`${entity} ${variant} fails closed`, async () => {
      const h = harness(); const table = entity === 'branch' ? h.state.branches : h.state.suppliers; const key = entity === 'branch' ? 'b1' : 's1';
      if (variant === 'missing') delete table[key];
      else if (variant === 'inactive') table[key]!.active = false;
      else delete table[key]!.active;
      const r = await h.send(); assert.equal(r.code, 403); noSend(h);
    });
  }
}

for (const purpose of ['resend', 'credit-claim']) {
  test(`${purpose} uses the stored order's branch/supplier`, async () => {
    const h = harness(); const r = await h.request({ body: storedBody(h, purpose) }); assert.equal(r.code, 200); assert.deepEqual(h.calls.order, ['o1']);
  });
}
for (const purpose of ['resend', 'delivery', 'credit-claim']) {
  for (const status of ['missing', 'DRAFT', 'CANCELLED']) {
    test(`${purpose} cannot act on ${status} order`, async () => {
      const h = harness(); h.state.user!.role = 'CREATOR';
      if (status === 'missing') delete h.state.orders.o1; else h.state.orders.o1!.status = status;
      const r = await h.request({ body: storedBody(h, purpose, purpose === 'delivery' ? { to: 'branch@example.test', cc: 'supplier@example.test' } : {}) });
      assert.equal(r.code, 403); noSend(h);
    });
  }
}
test('stored order scope cannot be overridden by submitted branch/supplier IDs', async () => {
  const h = harness(); const r = await h.request({ body: storedBody(h, 'resend', { branchId: 'b2', supplierId: 's2' }) });
  assert.equal(r.code, 400); noSend(h);
});
test('unrelated branch cannot resend a stored order', async () => {
  const h = harness(); h.state.user!.branchId = 'not-associated'; const r = await h.request({ body: storedBody(h, 'resend') }); assert.equal(r.code, 403); noSend(h);
});
test('linked supplier branch can deliver to the ordering branch', async () => {
  const h = harness(); h.state.user!.branchId = 'b2';
  const r = await h.request({ body: storedBody(h, 'delivery', { to: 'branch@example.test', cc: 'supplier@example.test' }) });
  assert.equal(r.code, 200); assert.deepEqual(h.calls.deliveries[0].mail.to, ['branch@example.test']);
});
test('linked supplier receiver can send a credit claim to supplier contacts', async () => {
  const h = harness(); h.state.user!.branchId = 'b2'; const r = await h.request({ body: storedBody(h, 'credit-claim') }); assert.equal(r.code, 200);
});
test('unrelated branch cannot send a delivery note', async () => {
  const h = harness(); h.state.user!.branchId = 'not-associated';
  const r = await h.request({ body: storedBody(h, 'delivery', { to: 'branch@example.test', cc: 'supplier@example.test' }) }); assert.equal(r.code, 403); noSend(h);
});
for (const role of ['CREATOR', 'GM']) {
  test(`${role} may send a delivery note for a stored order`, async () => {
    const h = harness(); h.state.user!.role = role; h.state.user!.branchId = 'elsewhere';
    const r = await h.request({ body: storedBody(h, 'delivery', { to: 'branch@example.test', cc: 'supplier@example.test' }) }); assert.equal(r.code, 200);
  });
}
test('delivery primary recipient must be the ordering branch, not the supplier', async () => {
  const h = harness(); h.state.user!.branchId = 'b2'; const r = await h.request({ body: storedBody(h, 'delivery') }); assert.equal(r.code, 403); noSend(h);
});
for (const role of ['STAFF', 'MANAGER', 'GM', 'CREATOR']) {
  test(`${role} price alert goes only to server-configured alert recipient`, async () => {
    const h = harness(); h.state.user!.role = role;
    const r = await h.request({ body: { purpose: 'price-alert', supplierId: 's1', subject: 'Price review', html: '<p>Fixture</p>' } });
    assert.equal(r.code, 200); assert.deepEqual(h.calls.deliveries[0].mail.to, ['operations@example.test']);
  });
}
test('price-alert cannot substitute an arbitrary recipient', async () => {
  const h = harness(); const r = await h.request({ body: { purpose: 'price-alert', supplierId: 's1', to: 'attacker@example.test', subject: 'Price review', html: '<p>Fixture</p>' } });
  assert.ok([400, 403].includes(r.code)); noSend(h);
});

for (const field of ['to', 'cc', 'replyTo']) {
  test(`arbitrary ${field} destination is denied`, async () => {
    const h = harness(); const r = await h.send({ [field]: 'attacker@example.test' }); assert.equal(r.code, 403); noSend(h);
  });
  test(`${field} header injection is rejected`, async () => {
    const h = harness(); const r = await h.send({ [field]: 'supplier@example.test\r\nBcc: attacker@example.test' }); assert.equal(r.code, 400); noSend(h);
  });
  test(`${field} address display-name syntax is rejected`, async () => {
    const h = harness(); const r = await h.send({ [field]: 'Supplier <supplier@example.test>' }); assert.equal(r.code, 400); noSend(h);
  });
}
test('missing primary order recipient is rejected', async () => {
  const h = harness(); const { to, ...body } = h.baseBody; const r = await h.request({ body }); assert.equal(r.code, 400); noSend(h);
});
test('subject cannot inject mail headers', async () => {
  const h = harness(); const r = await h.send({ subject: 'Order\nBcc: attacker@example.test' }); assert.equal(r.code, 400); noSend(h);
});
test('case-insensitive saved supplier contact is accepted', async () => {
  const h = harness(); const r = await h.send({ to: 'SUPPLIER@EXAMPLE.TEST' }); assert.equal(r.code, 200);
});
test('valid saved contact input is accepted while order envelope remains server-controlled', async () => {
  const h = harness(); const r = await h.send({ to: 'supplier@example.test, accounts@example.test', cc: 'branch@example.test, manager@example.test', replyTo: 'accounts@example.test' });
  assert.equal(r.code, 200); assert.deepEqual(h.calls.deliveries[0].mail.to, ['supplier@example.test', 'accounts@example.test']);
  assert.deepEqual(h.calls.deliveries[0].mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk']);
  assert.equal(h.calls.deliveries[0].mail.replyTo, 'branch@example.test');
});
test('recipient count is bounded', async () => {
  const h = harness(); const r = await h.send({ to: Array.from({ length: 21 }, (_, n) => `recipient${n}@example.test`).join(',') }); assert.equal(r.code, 400); noSend(h);
});
for (const patch of [
  { smtpSettings: { smtpHost: 'attacker.example.test', smtpUser: 'stolen', smtpPass: 'stolen', useSSL: false } },
  { from: 'attacker@example.test' }, { branchName: 'Spoofed sender' }, { bcc: 'attacker@example.test' }, { unknownField: true },
]) {
  test(`client transport/sender/unsupported field is rejected: ${Object.keys(patch)[0]}`, async () => {
    const h = harness(); const r = await h.send(patch); assert.equal(r.code, 400); noSend(h);
  });
}
for (const body of [null, [], 'payload', { purpose: 'unknown', subject: 'S', html: '<p>x</p>' }]) {
  test(`invalid body fails closed: ${JSON.stringify(body)}`, async () => {
    const h = harness(); const r = await h.request({ body }); assert.equal(r.code, 400); noSend(h);
  });
}
for (const patch of [{ subject: '' }, { html: '' }, { subject: 's'.repeat(201) }, { html: 'h'.repeat(200 * 1024 + 1) }]) {
  test(`empty/oversize content is rejected (${Object.keys(patch)[0]} length ${String(Object.values(patch)[0]).length})`, async () => {
    const h = harness(); const r = await h.send(patch); assert.ok([400, 413].includes(r.code)); noSend(h);
  });
}

test('validated attachments are Buffers with inferred MIME types and no access to paths/URLs', async () => {
  const h = harness(); const r = await h.send({ attachments: [attachment('訂單.pdf'), attachment('scan.png', png), attachment('scan.jpg', jpg)] }); assert.equal(r.code, 200);
  const { mail } = h.calls.deliveries[0]; assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
  assert.ok(mail.attachments.every((a: any) => Buffer.isBuffer(a.content)));
  assert.deepEqual(mail.attachments.map((a: any) => a.contentType), ['application/pdf', 'image/png', 'image/jpeg']);
  assert.deepEqual(mail.attachments[0].content, pdf);
  assert.deepEqual(Object.keys(mail.attachments[0]).sort(), ['content', 'contentType', 'filename']);
});
for (const key of ['path', 'href', 'raw', 'httpHeaders']) {
  test(`attachment ${key} cannot cause local/remote resource access`, async () => {
    const h = harness(); const r = await h.send({ attachments: [{ ...attachment(), [key]: key === 'httpHeaders' ? { authorization: 'private' } : 'https://attacker.example.test/private' }] }); assert.equal(r.code, 400); noSend(h);
  });
}
for (const filename of ['../secrets.pdf', '..\\secrets.pdf', '/tmp/secrets.pdf', 'C:\\secrets.pdf', 'evil\r\n.pdf', 'invoice.html', '.pdf', '']) {
  test(`unsafe attachment name rejected: ${JSON.stringify(filename)}`, async () => {
    const h = harness(); const r = await h.send({ attachments: [attachment(filename)] }); assert.equal(r.code, 400); noSend(h);
  });
}
for (const content of ['!!!', 'a', 'data:application/pdf;base64,' + pdf.toString('base64'), '', pdf.toString('base64') + '<script>']) {
  test(`invalid base64 rejected (${content.slice(0, 25)})`, async () => {
    const h = harness(); const r = await h.send({ attachments: [{ ...attachment(), content }] }); assert.equal(r.code, 400); noSend(h);
  });
}
test('attachment encoding other than base64 is rejected', async () => {
  const h = harness(); const r = await h.send({ attachments: [{ ...attachment(), encoding: 'hex' }] }); assert.equal(r.code, 400); noSend(h);
});
test('file magic must match allowed filename extension', async () => {
  const h = harness(); const r = await h.send({ attachments: [attachment('scan.png', pdf)] }); assert.equal(r.code, 400); noSend(h);
});
test('unrecognized magic is rejected even under a PDF extension', async () => {
  const h = harness(); const r = await h.send({ attachments: [attachment('scan.pdf', Buffer.from('<html>not a PDF</html>'))] }); assert.equal(r.code, 400); noSend(h);
});
test('more than three attachments is rejected', async () => {
  const h = harness(); const r = await h.send({ attachments: Array.from({ length: 4 }, () => attachment()) }); assert.equal(r.code, 400); noSend(h);
});
test('combined decoded attachment size is bounded, even when each is individually smaller', async () => {
  const h = harness(); const content = Buffer.alloc(900 * 1024, 32); pdf.copy(content);
  const r = await h.send({ attachments: [attachment('a.pdf', content), attachment('b.pdf', content), attachment('c.pdf', content)] }); assert.equal(r.code, 413); noSend(h);
});
test('exact decoded attachment size limit remains usable', async () => {
  const h = harness(); const content = Buffer.alloc(2.5 * 1024 * 1024, 32); pdf.copy(content);
  const r = await h.send({ attachments: [attachment('boundary.pdf', content)] }); assert.equal(r.code, 200);
  assert.equal(h.calls.deliveries[0].mail.attachments[0].content.length, content.length);
});
test('overall payload limit prevents oversized body processing', async () => {
  const h = harness(); const r = await h.send({ html: 'x'.repeat(4 * 1024 * 1024 + 1) }); assert.equal(r.code, 413); noSend(h);
});

test('allowed app origin is accepted', async () => {
  const h = harness(); const r = await h.request({ headers: { authorization: 'Bearer valid-token', origin: 'https://orders.example.test' } }); assert.equal(r.code, 200);
});
test('configured Vercel deployment origin is accepted', async () => {
  const h = harness(); h.state.env.VERCEL_URL = 'preview-orders.example.test';
  const r = await h.request({ headers: { authorization: 'Bearer valid-token', origin: 'https://preview-orders.example.test' } }); assert.equal(r.code, 200);
});
test('localhost is allowed only for explicitly local development', async () => {
  const h = harness(); h.state.env.NODE_ENV = 'development';
  const r = await h.request({ headers: { authorization: 'Bearer valid-token', origin: 'http://localhost:3000' } }); assert.equal(r.code, 200);
});
test('a Vercel preview cannot enable localhost origins by setting development mode', async () => {
  const h = harness(); h.state.env.NODE_ENV = 'development'; h.state.env.VERCEL_ENV = 'preview';
  const r = await h.request({ headers: { authorization: 'Bearer valid-token', origin: 'http://localhost:3000' } }); assert.equal(r.code, 403); noSend(h);
});
for (const origin of ['https://attacker.example.test', 'https://orders.example.test.attacker.example', 'null', 'http://localhost:3000']) {
  test(`untrusted origin denied: ${origin}`, async () => {
    const h = harness(); const r = await h.request({ headers: { authorization: 'Bearer valid-token', origin } }); assert.equal(r.code, 403); noSend(h);
    assert.notEqual(r.headers['access-control-allow-origin'], origin);
  });
}
test('GET is rejected without authenticating or sending', async () => {
  const h = harness(); const r = await h.request({ method: 'GET', headers: {} }); assert.equal(r.code, 405); noSend(h); assert.deepEqual(h.calls.verify, []);
});
test('allowed-origin preflight does not authenticate or send', async () => {
  const h = harness(); const r = await h.request({ method: 'OPTIONS', headers: { origin: 'https://orders.example.test' } }); assert.equal(r.code, 204); noSend(h); assert.deepEqual(h.calls.verify, []);
});

test('order SMTP login and sender come from the private server branch account', async () => {
  const h = harness(); const r = await h.send(); assert.equal(r.code, 200);
  const { config, mail } = h.calls.deliveries[0];
  assert.equal(config.host, h.state.env.SMTP_HOST); assert.equal(config.port, 465); assert.equal(config.secure, true);
  assert.deepEqual(config.auth, { user: 'branch@example.test', pass: 'mock-branch-one-password' });
  assert.equal(config.tls.rejectUnauthorized, true);
  assert.equal(mail.from.address, 'branch@example.test'); assert.equal(mail.from.name, 'Ordering branch');
  assert.equal(mail.replyTo, 'branch@example.test'); assert.deepEqual(mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk']);
  assert.deepEqual(h.calls.account, ['b1']);
  assert.doesNotMatch(JSON.stringify(r.data), /mock-branch-one-password|private-server-only-password|smtp\.example\.test/);
});
test('STARTTLS port requires TLS and verified certificates', async () => {
  const h = harness(); h.state.env.SMTP_PORT = '587'; h.state.env.SMTP_SECURE = 'false'; const r = await h.send(); assert.equal(r.code, 200);
  const { config } = h.calls.deliveries[0]; assert.equal(config.port, 587); assert.equal(config.secure, false); assert.equal(config.requireTLS, true); assert.equal(config.tls.rejectUnauthorized, true);
});
test('non-order sender may fall back to the shared server SMTP_USER when it is an email address', async () => {
  const h = harness(); delete h.state.env.SMTP_FROM_EMAIL; const r = await h.request({ body: storedBody(h, 'credit-claim') }); assert.equal(r.code, 200); assert.equal(h.calls.deliveries[0].mail.from.address, 'mailer@example.test');
});
for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS']) {
  test(`missing shared transport configuration ${key} fails non-order workflows without consuming quota`, async () => {
    const h = harness(); delete h.state.env[key]; const r = await h.request({ body: storedBody(h, 'credit-claim') }); assert.equal(r.code, 503); noSend(h);
  });
}
test('non-email SMTP username without a configured sender fails closed', async () => {
  const h = harness(); h.state.env.SMTP_USER = 'smtp-login'; delete h.state.env.SMTP_FROM_EMAIL; const r = await h.request({ body: storedBody(h, 'credit-claim') }); assert.equal(r.code, 503); noSend(h);
});
for (const purpose of ['order', 'resend']) {
  test(`${purpose} adds mandatory central CC and branch reply address even when omitted by client`, async () => {
    const h = harness(); const body = purpose === 'order' ? { ...h.baseBody } : storedBody(h, purpose);
    delete (body as Record<string, unknown>).cc; delete (body as Record<string, unknown>).replyTo;
    const r = await h.request({ body }); assert.equal(r.code, 200);
    const { mail } = h.calls.deliveries[0]; assert.deepEqual(mail.from, { name: 'Ordering branch', address: 'branch@example.test' });
    assert.equal(mail.replyTo, 'branch@example.test'); assert.deepEqual(mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk']);
  });
  test(`${purpose} overrides a valid client reply address with the branch mailbox`, async () => {
    const h = harness(); const body = purpose === 'order' ? { ...h.baseBody, replyTo: 'accounts@example.test' } : storedBody(h, purpose, { replyTo: 'accounts@example.test' });
    const r = await h.request({ body }); assert.equal(r.code, 200); assert.equal(h.calls.deliveries[0].mail.replyTo, 'branch@example.test');
  });
}
test('another branch uses its own mailbox login, sender and reply address', async () => {
  const h = harness(); h.state.user!.role = 'CREATOR';
  const r = await h.send({ branchId: 'b2', cc: 'receiver@example.test', replyTo: 'receiving-manager@example.test' }); assert.equal(r.code, 200);
  const { mail, config } = h.calls.deliveries[0]; assert.deepEqual(config.auth, { user: 'receiver@example.test', pass: 'mock-branch-two-password' });
  assert.equal(mail.from.address, 'receiver@example.test'); assert.equal(mail.replyTo, 'receiver@example.test'); assert.deepEqual(mail.cc, ['receiver@example.test', 'info@hareandtortoise.co.uk']);
});
for (const purpose of ['order', 'resend']) {
  test(`${purpose} includes administrator-saved external CC addresses in addition to mandatory central CC`, async () => {
    const h = harness(); h.state.accounts.b1!.cc = ['external-auditor@example.test'];
    const r = await h.request({ body: purpose === 'order' ? h.baseBody : storedBody(h, purpose) }); assert.equal(r.code, 200);
    assert.deepEqual(h.calls.deliveries[0].mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk', 'external-auditor@example.test']);
  });
}
test('saved CC recipients are normalized and deduplicated against mandatory CC and primary recipients', async () => {
  const h = harness(); h.state.accounts.b1!.cc = ['external@example.test', ' INFO@HAREANDTORTOISE.CO.UK ', 'SUPPLIER@EXAMPLE.TEST', 'EXTERNAL@EXAMPLE.TEST'];
  const r = await h.send(); assert.equal(r.code, 200);
  assert.deepEqual(h.calls.deliveries[0].mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk', 'external@example.test']);
});
test('missing or empty administrator CC still preserves mandatory central CC', async () => {
  const h = harness(); h.state.accounts.b1!.cc = [];
  const r = await h.send(); assert.equal(r.code, 200); assert.deepEqual(h.calls.deliveries[0].mail.cc, ['branch@example.test', 'info@hareandtortoise.co.uk']);
});
test('HTTP clients cannot request arbitrary external CC even when it is a saved admin recipient', async () => {
  const h = harness(); h.state.accounts.b1!.cc = ['external-auditor@example.test'];
  const r = await h.send({ cc: 'external-auditor@example.test' }); assert.equal(r.code, 403); noSend(h);
});
test('combined primary, mandatory and saved CC recipient count cannot exceed twenty', async () => {
  const h = harness(); h.state.accounts.b1!.cc = Array.from({ length: 19 }, (_, n) => `admin-cc-${n}@example.test`);
  const r = await h.send(); assert.equal(r.code, 400); noSend(h);
});
test('orders do not require or fall back to shared SMTP credentials', async () => {
  const h = harness(); delete h.state.env.SMTP_USER; delete h.state.env.SMTP_PASS;
  const r = await h.send(); assert.equal(r.code, 200); assert.equal(h.calls.deliveries[0].config.auth.user, 'branch@example.test');
});
for (const scenario of [
  { label: 'missing account', value: undefined },
  { label: 'empty account', value: {} },
  { label: 'missing password', value: { user: 'branch@example.test' } },
  { label: 'empty password', value: { user: 'branch@example.test', pass: '' } },
  { label: 'wrong mailbox identity', value: { user: 'other-mailbox@example.test', pass: 'mock-pass' } },
  { label: 'missing mailbox identity', value: { pass: 'mock-pass' } },
  { label: 'invalid password type', value: { user: 'branch@example.test', pass: 123 } },
]) {
  test(`missing/invalid private branch mailbox fails closed (${scenario.label})`, async () => {
    const h = harness(); h.state.accounts.b1 = scenario.value;
    const r = await h.send(); assert.equal(r.code, 503); noSend(h);
    assert.doesNotMatch(JSON.stringify(r.data), /mock-pass|private-server-only-password/);
  });
}
test('private branch-account retrieval failure fails closed without disclosing storage details', async () => {
  const h = harness(); h.state.accountReadError = new Error('ciphertext storage detail and mock-branch-one-password');
  const r = await h.send(); assert.equal(r.code, 503); noSend(h); assert.deepEqual(h.calls.account, ['b1']);
  assert.doesNotMatch(JSON.stringify(r.data), /ciphertext|storage detail|mock-branch-one-password/);
});
test('missing private branch account does not fall back to legacy environment or shared credentials', async () => {
  const h = harness(); delete h.state.accounts.b1;
  h.state.env.SMTP_BRANCH_ACCOUNTS_JSON = JSON.stringify({ b1: { user: 'branch@example.test', pass: 'legacy-mock-password' } });
  const r = await h.send(); assert.equal(r.code, 503); noSend(h);
});
test('branch mailbox transport overrides come exclusively from server configuration', async () => {
  const h = harness(); h.state.accounts.b1 = { user: 'branch@example.test', pass: 'mock-pass', host: 'branch-smtp.example.test', port: 587, secure: false };
  delete h.state.env.SMTP_HOST;
  const r = await h.send(); assert.equal(r.code, 200); const { config } = h.calls.deliveries[0];
  assert.equal(config.host, 'branch-smtp.example.test'); assert.equal(config.port, 587); assert.equal(config.secure, false); assert.equal(config.requireTLS, true); assert.equal(config.tls.rejectUnauthorized, true);
});
test('order fails if neither its account nor shared defaults configure a host', async () => {
  const h = harness(); delete h.state.env.SMTP_HOST; const r = await h.send(); assert.equal(r.code, 503); noSend(h);
});
test('price alerts require server-configured destinations', async () => {
  const h = harness(); delete h.state.env.SMTP_ALERT_TO;
  const r = await h.request({ body: { purpose: 'price-alert', supplierId: 's1', subject: 'Price review', html: '<p>Fixture</p>' } }); assert.equal(r.code, 503); noSend(h);
});
test('rate-limited valid request never invokes SMTP', async () => {
  const h = harness(); h.state.reservation = false; const r = await h.send(); assert.equal(r.code, 429); assert.deepEqual(h.calls.reserve, ['u1']); assert.equal(h.calls.deliveries.length, 0);
});
test('rate limiter outage fails closed', async () => {
  const h = harness(); h.state.reservationError = new Error('counter storage internals'); const r = await h.send(); assert.equal(r.code, 503); assert.equal(h.calls.deliveries.length, 0); assert.doesNotMatch(JSON.stringify(r.data), /counter storage internals/);
});
test('SMTP exception returns a generic gateway error without secrets', async () => {
  const h = harness(); h.state.deliveryError = new Error('535 private-server-only-password smtp.example.test'); const r = await h.send(); assert.equal(r.code, 502); assert.equal(h.calls.deliveries.length, 1);
  assert.doesNotMatch(JSON.stringify(r.data), /private-server-only-password|smtp\.example\.test|535/);
});
for (const result of [
  { accepted: [], rejected: ['supplier@example.test', 'branch@example.test'] },
  { accepted: ['supplier@example.test'], rejected: ['branch@example.test'] },
  { accepted: ['supplier@example.test'], rejected: [] },
]) {
  test(`partial/missing SMTP acceptance is not success: ${JSON.stringify(result)}`, async () => {
    const h = harness(); h.state.deliveryResult = result; const r = await h.send(); assert.equal(r.code, 502); assert.equal(h.calls.deliveries.length, 1);
  });
}

test('order email rejects a changed recipient preview before SMTP',async()=>{
 const h=harness();const r=await h.send({routeKey:'stale-preview'});assert.equal(r.code,409);noSend(h);
});
test('custom permission mode without submit cannot send an order email',async()=>{
 const h=harness();h.state.user!.permissionMode='CUSTOM';h.state.user!.customPermissions=['create_orders'];
 const r=await h.send();assert.equal(r.code,403);noSend(h);
});
