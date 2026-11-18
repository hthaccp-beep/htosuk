import { config as loadEnvironment } from 'dotenv';
const cloudPreview = process.argv.includes('--cloud');
loadEnvironment({ path: cloudPreview ? '.env.cloud.local' : '.env.local', quiet: true });
if (!cloudPreview && process.env.NODE_ENV !== 'production' && !process.env.HTOS_MODE) {
  Object.assign(process.env, {
    HTOS_MODE: 'emulator',
    FIREBASE_PROJECT_ID: 'demo-htos',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9095',
    VITE_HTOS_MODE: process.env.VITE_HTOS_MODE || 'emulator',
    VITE_FIREBASE_PROJECT_ID: process.env.VITE_FIREBASE_PROJECT_ID || 'demo-htos',
  });
} else if (process.env.NODE_ENV !== 'production' && process.env.HTOS_MODE === 'cloud' && process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  if (process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8085') delete process.env.FIRESTORE_EMULATOR_HOST;
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9095') delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}
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
import invoiceReadingHandler from './api/admin/invoice-reading';
import orderActionHandler from './api/admin/order-action';
import importDataHandler from './api/admin/import-data';
import scanInvoiceHandler from './api/scan-invoice';
import ocrHandler from './api/ocr';
import authSyncHandler from './api/auth-sync';
import { priceChangeApiHandler } from './api/admin/price-change';
import release from './app-version.json' with { type: 'json' };

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
  const PORT = Number(process.env.PORT || 3000);

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
  app.all('/api/admin/workspace', express.json({ limit: process.env.HTOS_ENABLE_INVOICE_CASES==='true'?'4.5mb':'3mb' }), vercelAdapter(workspaceAdminHandler));
  app.all('/api/admin/invoice-reading', express.json({ limit: '16kb' }), vercelAdapter(invoiceReadingHandler));
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
    app.get('/app-version.json', (req, res, next) => {
      if ('import' in req.query) return next();
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.json(release);
    });
    app.get('/sw.js', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.type('application/javascript').send(
        `self.addEventListener('message',event=>{if(event.data?.type==='HTOS_RELEASE')event.ports?.[0]?.postMessage({version:${JSON.stringify(release.version)}});});`
      );
    });
    const vite = await createViteServer({
      mode: cloudPreview ? 'cloud' : 'development',
      server: { middlewareMode: true, allowedHosts: true },
      appType: "spa",
    });
    app.get(['/draft-table', '/sample-check'], async (req, res, next) => {
      try {
        const fs = await import('node:fs/promises');
        const raw = await fs.readFile(path.join(process.cwd(), 'tests', 'ui-preview.html'), 'utf8');
        const injected = raw.replace('<head>', '<head><script>window.__HTOS_PREVIEW_DEFAULT="table";</script>');
        const html = await vite.transformIndexHtml(req.originalUrl, injected);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(html);
      } catch (err) {
        next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('/{*path}', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
