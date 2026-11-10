import { config as loadEnvironment } from 'dotenv';
const cloudPreview = process.argv.includes('--cloud');
loadEnvironment({ path: cloudPreview ? '.env.cloud.local' : '.env.local', quiet: true });
import { validateCloudSetup } from './server/htos-runtime.ts';
if (cloudPreview) validateCloudSetup(process.env);
import { getAdmin } from './api/firebase-admin.ts';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cors from 'cors';
import sendEmailHandler from './api/send-email';
import branchEmailHandler from './api/admin/branch-email';
import adminUsersHandler from './api/admin/users';
import workspaceAdminHandler from './api/admin/workspace';
import orderActionHandler from './api/admin/order-action';
import importDataHandler from './api/admin/import-data';
import scanInvoiceHandler from './api/scan-invoice';
import ocrHandler from './api/ocr';
import authSyncHandler from './api/auth-sync';
import { priceChangeApiHandler } from './api/admin/price-change';

if (process.env.SMTP_SECURE && !['true', 'false'].includes(process.env.SMTP_SECURE.toLowerCase())) {
  if (!process.env.SMTP_FROM_NAME) {
    process.env.SMTP_FROM_NAME = process.env.SMTP_SECURE;
  }
  process.env.SMTP_SECURE = (process.env.SMTP_PORT || '465') === '465' ? 'true' : 'false';
} else if (!process.env.SMTP_SECURE) {
  process.env.SMTP_SECURE = (process.env.SMTP_PORT || '465') === '465' ? 'true' : 'false';
}



async function verifyActiveUser(authHeader: string | undefined): Promise<boolean> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  const token = authHeader.split('Bearer ')[1];
  try {
    const { auth, db } = getAdmin();
    const decoded = await auth.verifyIdToken(token, true); // Revocation check!
    const userDoc = await db.collection('users').doc(decoded.uid).get();
    return userDoc.exists && userDoc.data()?.active === true;
  } catch (_) {
    return false;
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3005);

  // Polyfill `req.body` wrapper to simulate VercelRequest behavior for existing files
  function vercelAdapter(handler: any) {
    return async (req: express.Request, res: express.Response) => {
      try {
        await handler(req, res);
      } catch (e) {
        console.error('Vercel Adapter Error:', e);
        if (!res.headersSent) res.status(500).json({ error: 'Internal Server Error' });
      }
    };
  }

  // API Routes
  // Email, User Admin, and OCR endpoints own strict size limits and authorization
  app.all('/api/send-email', express.json({ limit: '4mb' }), vercelAdapter(sendEmailHandler));
  app.all('/api/admin/branch-email', express.json({ limit: '16kb' }), vercelAdapter(branchEmailHandler));
  app.all('/api/admin/import-data', express.json({ limit: '3mb' }), vercelAdapter(importDataHandler));
  app.all('/api/admin/users', express.json({ limit: '64kb' }), vercelAdapter(adminUsersHandler));
  app.all('/api/admin/workspace', express.json({ limit: '3mb' }), vercelAdapter(workspaceAdminHandler));
  app.all('/api/admin/order-action', express.json({ limit: '16kb' }), vercelAdapter(orderActionHandler));
  app.all('/api/scan-invoice', express.json({ limit: '50mb' }), vercelAdapter(scanInvoiceHandler));
  app.all('/api/ocr', express.json({ limit: '50mb' }), vercelAdapter(ocrHandler));
  app.all('/api/auth/sync-profile', express.json({ limit: '16kb' }), vercelAdapter(authSyncHandler));
  app.all('/api/admin/price-change', express.json({ limit: '4mb' }), vercelAdapter(priceChangeApiHandler));

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // CSV Download Route
  app.get('/api/download-csv', async (req, res) => {
    if (!(await verifyActiveUser(req.headers.authorization))) {
      res.status(401).json({ error: 'Sign in to download catalogue files.' });
      return;
    }
    const csvPath = path.join(process.cwd(), 'HARE_AND_TORTOISE_GROUP_PRICE_02-2026_UPDATED.csv');
    res.download(csvPath, 'HARE_AND_TORTOISE_GROUP_PRICE_02-2026_UPDATED.csv', (err) => {
      if (err && !res.headersSent) {
        res.status(404).send('CSV file not found');
      }
    });
  });

  // Serve public static directory
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      mode: cloudPreview ? 'cloud' : 'development',
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
