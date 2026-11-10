import { getAdmin } from '../firebase-admin.ts';
import {auditSuccessfulResponse} from '../../server/admin-audit.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createUserAdminHandler, checkUserAdminPermission, UserAdminError } from '../../server/user-admin-service.ts';
import type { UserDoc } from '../../server/user-admin-service.ts';

// Lazy, resilient Firebase Admin initialization
let _hasAdminCredentials: boolean | null = null;



const handler = createUserAdminHandler({
  verifyToken: async token => {
    try {
      const { auth } = getAdmin();
      // Enforce token verification against server-configured project with revocation checking
      const decoded = await auth.verifyIdToken(token, true);
      return { uid: decoded.uid };
    } catch (tokenErr) {
      console.warn('verifyToken error in users admin:', (tokenErr as any)?.message);
      throw tokenErr;
    }
  },
  getUser: async uid => {
    const { db } = getAdmin();
    try {
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) {
        return snap.data() as UserDoc;
      }
      // Check if document exists with matching username
      const byUsername = await db.collection('users').where('username', '==', uid).get();
      if (!byUsername.empty) {
        return byUsername.docs[0].data() as UserDoc;
      }
    } catch (err: any) {
      console.warn('Firestore read error in getUser for uid:', uid, err.message);
      throw err;
    }
    return undefined;
  },
  createUserAuth: async ({ email, password, displayName }) => {
    const { auth } = getAdmin();
    const rec = await auth.createUser({ email, password, displayName });
    return { uid: rec.uid };
  },
  updateUserAuth: async (uid, params) => {
    const { auth } = getAdmin();
    await auth.updateUser(uid, params);
  },
  revokeUserTokens: async uid => {
    const { auth } = getAdmin();
    await auth.revokeRefreshTokens(uid);
  },
  deleteUserAuth: async uid => {
    const { auth } = getAdmin();
    await auth.deleteUser(uid);
  },
  createUserProfile: async (uid, data) => {
    const { db } = getAdmin();
    try {
      await db.collection('users').doc(uid).set(data);
    } catch (err: any) {
      const isQuota = err?.code === 8 || err?.status === 8 || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded');
      if (isQuota) {
        const quotaErr: any = new Error('Firestore database daily quota limit exceeded. User account was registered, but profile write hit quota limit.');
        quotaErr.code = 8;
        quotaErr.status = 503;
        throw quotaErr;
      }
      throw err;
    }
  },
  updateUserProfile: async (uid, patch, expectedVersion) => {
    const { db } = getAdmin();
    try {
      if (expectedVersion) {
        await db.runTransaction(async tx => {
          const ref = db.collection('users').doc(uid);
          const snap = await tx.get(ref);
          if (!snap.exists) throw new Error('User document not found');
          const current = snap.data() as UserDoc;
          if (expectedVersion.role && current.role !== expectedVersion.role) {
            throw new Error('Target user role changed concurrently.');
          }
          if (expectedVersion.branchId !== undefined && (current.branchId || '') !== expectedVersion.branchId) {
            throw new Error('Target user branch changed concurrently.');
          }
          tx.update(ref, patch);
        });
      } else {
        await db.collection('users').doc(uid).update(patch);
      }
    } catch (err: any) {
      const isQuota = err?.code === 8 || err?.status === 8 || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded');
      if (isQuota) {
        const quotaErr: any = new Error('Firestore database daily quota limit exceeded.');
        quotaErr.code = 8;
        quotaErr.status = 503;
        throw quotaErr;
      }
      throw err;
    }
  },
  deleteUserProfile: async uid => {
    const { db } = getAdmin();
    try {
      await db.collection('users').doc(uid).delete();
    } catch (err: any) {
      const isQuota = err?.code === 8 || err?.status === 8 || err?.message?.includes('RESOURCE_EXHAUSTED') || err?.message?.includes('Quota exceeded');
      if (isQuota) {
        const quotaErr: any = new Error('Firestore database daily quota limit exceeded.');
        quotaErr.code = 8;
        quotaErr.status = 503;
        throw quotaErr;
      }
      throw err;
    }
  },
  saveUserOrder: async (requesterUid, items, timestamp) => {
    const {db} = getAdmin();
    await db.runTransaction(async tx => {
      const ids = [...new Set([requesterUid, ...items.map(item => item.id)])];
      const snapshots = await tx.getAll(...ids.map(id => db.collection('users').doc(id)));
      const profiles = new Map(snapshots.map(snap => [snap.id, snap.exists ? {...snap.data(), id: snap.id} as UserDoc : undefined]));
      const requester = profiles.get(requesterUid);
      if (!requester) throw new UserAdminError(403, 'Requester account profile not found.');
      for (const item of items) {
        const target = profiles.get(item.id);
        if (!target || (target.displayOrder || 0) !== item.expectedDisplayOrder) {
          throw new UserAdminError(409, 'The user order changed. Reload the list and try again.');
        }
        checkUserAdminPermission(requester, item.id, target, undefined, 'reorder');
      }
      for (const item of items) {
        tx.update(db.collection('users').doc(item.id), {displayOrder: item.displayOrder, updatedAt: timestamp, updatedBy: requesterUid});
      }
    }, {maxAttempts: 1});
  },
});

export default async function usersAdminHandler(req: VercelRequest, res: VercelResponse) {
  auditSuccessfulResponse(req,res,'USER');
  try {
    return await handler(req, res);
  } catch (error: any) {
    console.error('User Admin API Unhandled Error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: error?.message || 'Internal User Admin Server Error' });
    }
  }
}
