import { externalServiceEnabled } from '../server/htos-runtime.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import nodemailer from 'nodemailer';
import { auth, db } from './firebase-admin.ts';
import { createEmailHandler } from '../server/email-service.ts';
import { getBranchEmailAccount } from './admin/branch-email.ts';
import {activeProfile,verifySession} from '../server/verified-identity.ts';


if (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE.toLowerCase())) {
  if (!process.env.SMTP_FROM_NAME) {
    process.env.SMTP_FROM_NAME = process.env.SMTP_SECURE;
  }
  process.env.SMTP_SECURE = (process.env.SMTP_PORT || '465') === '465' ? 'true' : 'false';
} else if (!process.env.SMTP_SECURE) {
  process.env.SMTP_SECURE = (process.env.SMTP_PORT || '465') === '465' ? 'true' : 'false';
}

const getDocument = async (collection: string, id: string) => {
  try {
    const snapshot = await db.collection(collection).doc(id).get();
    return snapshot.exists ? snapshot.data() : undefined;
  } catch (err) {
    console.warn(`Firestore read error on ${collection}/${id}:`, err);
    return undefined;
  }
};

// Transactions enforce limits across instances. Unmatched Firestore paths are
// denied to clients by the current rules, so only the server can update these.
async function reserveSend(uid: string): Promise<boolean> {
  const refs = [
    { ref: db.collection('_email_send_limits').doc(`user_${uid}`), limit: 20 },
    { ref: db.collection('_email_send_limits').doc('global'), limit: 100 },
  ];
  return db.runTransaction(async transaction => {
    const windowStart = Math.floor(Date.now() / 60000) * 60000;
    const snapshots = await transaction.getAll(...refs.map(item => item.ref));
    const counts = snapshots.map(snapshot => {
      const data = snapshot.data();
      return data?.windowStart === windowStart && Number.isInteger(data?.count) ? Math.max(0, data!.count) : 0;
    });
    if (counts.some((count, index) => count >= refs[index].limit)) return false;
    refs.forEach((item, index) => transaction.set(item.ref, { windowStart, count: counts[index] + 1 }));
    return true;
  });
}

const sendEmail = createEmailHandler({
  env: process.env,
  verifyToken: token => verifySession(auth,token),
  getUser: uid => activeProfile(db,uid),
  getBranch: id => getDocument('branches',id),
  getSupplier: id => getDocument('suppliers',id),
  getOrder: id => getDocument('orders', id),
  getBranchEmailAccount: id => getBranchEmailAccount(id),
  getRolePermissions: async () => (await db.collection('settings').doc('role_permissions').get()).data()?.map,
  reserveSend,
  deliver: async (mail, config) => {
    const verifiedUser = process.env.SMTP_USER;
    const verifiedPass = process.env.SMTP_PASS && process.env.SMTP_PASS !== '/* secret */' && process.env.SMTP_PASS !== 'P@ssword1' ? process.env.SMTP_PASS : undefined;
    const verifiedHost = process.env.SMTP_HOST;
    const verifiedPort = Number(process.env.SMTP_PORT || '465');

    const transporter = nodemailer.createTransport(config);
    try {
      console.log(`[SMTP Deliver Attempt] Host: ${config.host}:${config.port}, User: ${config.auth?.user}, To: ${mail.to.join(', ')}`);
      const result = await transporter.sendMail(mail);
      console.log(`[SMTP Deliver Success] Accepted: ${result.accepted?.join(', ')}`);
      return {
        accepted: (result.accepted || []).map((address: any) => typeof address === 'string' ? address : (address?.address || String(address))),
        rejected: (result.rejected || []).map((address: any) => typeof address === 'string' ? address : (address?.address || String(address))),
      };
    } catch (deliverErr: any) {
      console.warn(`[SMTP Deliver Primary Failed] User: ${config.auth?.user} -> ${deliverErr?.message}`);
      try { transporter.close(); } catch (_) {}

      const errorMsg = String(deliverErr?.message || deliverErr || '');
      const isTimeout = /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(errorMsg);

      // CRITICAL (R04): After ambiguous SMTP timeout, do not automatically retry or fallback!
      if (isTimeout) {
        const timeoutErr: any = new Error('The mail server timed out during delivery. Check branch inbox to verify if the email was sent before resending.');
        timeoutErr.status = 502;
        throw timeoutErr;
      }

      // Central fallback only for a confirmed pre-acceptance connection failure
      const isPreAcceptanceFailure = /535|authentication failed|wrong user\/password|ECONNREFUSED/i.test(errorMsg);

      if (
        isPreAcceptanceFailure &&
        verifiedUser &&
        verifiedPass &&
        verifiedHost &&
        config.auth?.user !== verifiedUser
      ) {
        console.log(`[SMTP Deliver Fallback] Delivering via verified central SMTP mailbox (${verifiedUser})...`);
        const fallbackConfig = {
          ...config,
          host: verifiedHost,
          port: verifiedPort,
          secure: verifiedPort === 465,
          requireTLS: verifiedPort !== 465,
          auth: { user: verifiedUser, pass: verifiedPass },
        };
        const fallbackTransporter = nodemailer.createTransport(fallbackConfig as any);
        try {
          const fallbackMail = {
            ...mail,
            from: {
              name: mail.from.name || 'Hare & Tortoise Order System',
              address: verifiedUser,
            },
            replyTo: mail.replyTo || mail.from.address,
          };
          const fallbackResult = await fallbackTransporter.sendMail(fallbackMail);
          console.log(`[SMTP Deliver Fallback Success] Accepted: ${fallbackResult.accepted?.join(', ')}`);
          return {
            accepted: (fallbackResult.accepted || []).map((address: any) => typeof address === 'string' ? address : (address?.address || String(address))),
            rejected: (fallbackResult.rejected || []).map((address: any) => typeof address === 'string' ? address : (address?.address || String(address))),
          };
        } catch (retryErr: any) {
          console.error(`[SMTP Deliver Fallback Failed]:`, retryErr?.message || retryErr);
          throw retryErr;
        } finally {
          try { fallbackTransporter.close(); } catch (_) {}
        }
      }
      throw deliverErr;
    } finally {
      try { transporter.close(); } catch (_) {}
    }
  },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!externalServiceEnabled('EMAIL')) return res.status(503).json({ error: 'HTOS email is disabled. No external request was made.' });
  try {
    const body = req.body;
    if(body?.purpose==='credit-claim')return res.status(400).json({error:'Send supplier requests through Delivery & Invoice Check after reviewing the saved discrepancies and accounts copies.'});
    if (body && (body.purpose === 'order' || body.purpose === 'resend')) {
      if (!body.orderId || typeof body.orderId !== 'string' || !body.orderId.trim()) {
        return res.status(400).json({ error: 'A persisted order ID is required to send or resend order emails.' });
      }
    }
    return await sendEmail(req, res);
  } catch (error: any) {
    console.error('Send Email API Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Email service is unavailable. Please retry later.' });
    }
  }
}
