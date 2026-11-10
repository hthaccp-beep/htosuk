import { externalServiceEnabled } from '../server/htos-runtime.ts';
import { getAdmin } from './firebase-admin.ts';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI, Type } from '@google/genai';
import { inflateSync, unzipSync } from 'node:zlib';
import {
  validateOcrAuthorization,
  validateOcrPayload,
  checkOcrRateLimit,
  OcrSecurityError,
  type AuthenticatedUser,
} from '../server/ocr-security.ts';
import {activeProfile,verifySession} from '../server/verified-identity.ts';
import {checkUserActionPermission} from '../server/order-authorization.ts';
import {hasBranchScope} from '../shared/order-scope.ts';

/**
 * Lightweight, zero-dependency text extraction from PDF stream buffers.
 * Safely runs in any serverless/edge environment without native binary dependencies.
 */
export function extractTextFromPdfBuffer(buffer: Buffer): string {
  try {
    const rawChunks = [buffer.toString('latin1')];
    let idx = 0;
    while ((idx = buffer.indexOf('stream', idx)) !== -1) {
      const start = idx + 6;
      const streamStart = buffer[start] === 0x0a ? start + 1 : (buffer[start] === 0x0d && buffer[start + 1] === 0x0a ? start + 2 : start);
      const end = buffer.indexOf('endstream', streamStart);
      if (end === -1) break;
      const slice = buffer.subarray(streamStart, end);
      try {
        const decompressed = inflateSync(slice,{maxOutputLength:4*1024*1024});
        rawChunks.push(decompressed.toString('latin1'));
      } catch (_) {
        try {
          const unzipped = unzipSync(slice,{maxOutputLength:4*1024*1024});
          rawChunks.push(unzipped.toString('latin1'));
        } catch (_) {}
      }
      if(rawChunks.reduce((sum,chunk)=>sum+chunk.length,0)>8*1024*1024) return '';
      idx = end + 9;
    }

    const fullText = rawChunks.join('\n');
    const lines: string[] = [];

    const btEtRegex = /BT[\s\S]*?ET/g;
    let match: RegExpExecArray | null;
    while ((match = btEtRegex.exec(fullText)) !== null) {
      const block = match[0];
      const blockStrings: string[] = [];
      const tjRegex = /\(([^)]+)\)\s*(?:Tj|'|")/g;
      let tjMatch: RegExpExecArray | null;
      while ((tjMatch = tjRegex.exec(block)) !== null) {
        blockStrings.push(tjMatch[1]);
      }
      const arrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
      let arrMatch: RegExpExecArray | null;
      while ((arrMatch = arrayRegex.exec(block)) !== null) {
        const inner = arrMatch[1];
        const innerTjRegex = /\(([^)]+)\)/g;
        let innerMatch: RegExpExecArray | null;
        while ((innerMatch = innerTjRegex.exec(inner)) !== null) {
          blockStrings.push(innerMatch[1]);
        }
      }
      if (blockStrings.length > 0) {
        lines.push(blockStrings.join(' ').replace(/\\([()\\])/g, '$1').trim());
      }
    }

    return lines.join('\n').replace(/\\r/g, ' ').replace(/\\t/g, ' ').trim();
  } catch (_) {
    return '';
  }
}

export function redactSecrets(str?: string): string {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_API_KEY]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/key=[^&\s]+/gi, 'key=[REDACTED]')
    .replace(/private_key["']?\s*:\s*["'][^"']+["']/gi, 'private_key: "[REDACTED]"');
}



export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = (req.headers['x-request-id'] as string) || `ocr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  res.setHeader('X-Request-Id', requestId);

  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization, X-Request-Id'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', code: 'ERR_METHOD_NOT_ALLOWED', requestId });
  }

  try {
    // 1. Authentication Check against server-configured Firebase project
    const authHeader = req.headers.authorization;
    if (!authHeader || typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized: Authentication required. Please sign in.',
        code: 'ERR_AUTH_MISSING',
        requestId 
      });
    }
    const token = authHeader.split('Bearer ')[1]?.trim();
    if (!token) {
      return res.status(401).json({ 
        error: 'Unauthorized: Missing bearer token.',
        code: 'ERR_AUTH_MISSING',
        requestId 
      });
    }

  if (!externalServiceEnabled('OCR')) return res.status(503).json({ error: 'HTOS ocr is disabled. No external request was made.' });

    let adminDb: any;
    let adminAuth: any;
    try {
      const admin = getAdmin();
      adminDb = admin.db;
      adminAuth = admin.auth;
    } catch (adminErr: any) {
      console.error(`[${requestId}] Firebase Admin initialization error:`, redactSecrets(adminErr?.message));
      return res.status(500).json({ 
        error: 'Server configuration error: Firebase authentication service unavailable.',
        code: 'ERR_CONFIG_FIREBASE',
        requestId 
      });
    }

    let currentUid: string;
    try { currentUid = (await verifySession(adminAuth,token)).uid; }
    catch { return res.status(401).json({error:'Invalid or expired session. Please sign in again.',code:'ERR_AUTH_EXPIRED',requestId}); }
    const userData = await activeProfile(adminDb,currentUid);
    const roles = (await adminDb.collection('settings').doc('role_permissions').get()).data()?.map;
    const {branchId,itemsList} = req.body || {};
    if (!userData || !checkUserActionPermission(userData,'scan_invoices',roles) || (branchId && !hasBranchScope(userData,branchId))) {
      return res.status(403).json({error:'Document scanning is not available to this account or branch.',code:'ERR_SCAN_PERMISSION',requestId});
    }
    validateOcrAuthorization(userData,{branchId});

    // 4. Rate Limiting Check
    checkOcrRateLimit(currentUid);

    // 5. Decoded Payload & Magic Byte Validation
    const { buffer, mimeType } = validateOcrPayload(req.body);

    // 6. Gemini API Key Configuration
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(500).json({ 
        error: 'Gemini API key is not configured on the server. Please add GEMINI_API_KEY in your Vercel Project Settings > Environment Variables and redeploy.',
        code: 'ERR_CONFIG_GEMINI_KEY',
        requestId 
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const prompt = `You are a highly accurate OCR and data extraction assistant for a restaurant inventory & invoice management system.
I am providing an image or PDF of a delivery receipt or supplier invoice.
I need you to look at the document, extract the header details (invoice/delivery note number and date), and match lines on the document to our ordered items list.

Here is the list of products we ordered:
[${itemsList || ''}]

Please extract:
1. Header information: Invoice Number and Invoice Date (if present).
2. For each matched item:
   - Delivered case quantity (box/case) and delivered pack/unit quantity.
   - Invoiced price per case/box (price charged by supplier) and/or price per unit/pack.
   - Total line price on invoice.
   - Any notes, handwritten marks, or condition codes (e.g., "damaged", "short", "rejected", "substitutions").

Note: The receipt might use slightly different names, abbreviations, or codes. Use your best judgment to fuzzy match the document text to our product list.

Return the result STRICTLY as a JSON object with this exact structure:
{
  "invoiceNumber": "string",
  "invoiceDate": "YYYY-MM-DD",
  "totalAmount": 0,
  "extractedItems": [
    {
      "matchedOrderName": "string",
      "rawDescription": "string",
      "deliveredCaseQty": 0,
      "deliveredPackQty": 0,
      "invoicedCasePrice": 0,
      "invoicedPackPrice": 0,
      "totalLinePrice": 0,
      "notes": ""
    }
  ]
}`;

    let extractedPdfText = '';
    let imageToProcess: { data: string; mimeType: string } | null = null;

    if (mimeType === 'application/pdf') {
      extractedPdfText = extractTextFromPdfBuffer(buffer);

      // If document is a scanned PDF (little or no extractable digital text), check for embedded JPEG stream
      if (extractedPdfText.length < 20) {
        const startIdx = buffer.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
        const endIdx = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
        if (startIdx !== -1 && endIdx > startIdx) {
          const jpegBuf = buffer.subarray(startIdx, endIdx + 2);
          imageToProcess = { data: jpegBuf.toString('base64'), mimeType: 'image/jpeg' };
        }
      }
    } else {
      imageToProcess = { data: buffer.toString('base64'), mimeType };
    }

    // Build Gemini contents
    const geminiParts: any[] = [];
    if (mimeType === 'application/pdf') {
      // Gemini natively processes PDF documents via inlineData
      geminiParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
      if (extractedPdfText.length >= 20) {
        geminiParts.push({
          text: `=== DOCUMENT RAW TEXT EXTRACTED FROM INVOICE ===\n${extractedPdfText.slice(0, 30000)}`
        });
      }
      geminiParts.push({ text: prompt });
    } else if (imageToProcess) {
      geminiParts.push({ inlineData: { data: imageToProcess.data, mimeType: imageToProcess.mimeType } });
      geminiParts.push({ text: prompt });
    } else {
      geminiParts.push({ inlineData: { data: buffer.toString('base64'), mimeType } });
      geminiParts.push({ text: prompt });
    }

    // Timeout-bounded execution (50 seconds for multimodal/PDF analysis)
    const timeoutPromise = new Promise<never>((_, rejectTimeout) =>
      setTimeout(() => rejectTimeout(new Error('OCR provider request timed out after 50 seconds')), 50000)
    );

    const runGemini = async () => {
      const candidateModels = ['gemini-3.1-flash-lite', 'gemini-flash-latest', 'gemini-3.8-flash'];
      let lastError: any = null;

      for (const model of candidateModels) {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const attemptPromise = ai.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: geminiParts,
                },
              ],
              config: {
                temperature: 0.1,
                responseMimeType: 'application/json',
              },
            });
            const attemptTimeout = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Timeout with model ${model}`)), 15000)
            );
            return await Promise.race([attemptPromise, attemptTimeout]);
          } catch (mErr: any) {
            lastError = mErr;
            const msg = String(mErr?.message || '');
            console.warn(`[${requestId}] Gemini model "${model}" attempt ${attempt} failed in ocr:`, msg.slice(0, 150));
            if (msg.includes('503') || msg.includes('429') || msg.includes('UNAVAILABLE') || msg.includes('high demand') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Timeout')) {
              break; // Try next fallback model immediately!
            }
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 600));
            }
          }
        }
      }
      throw lastError || new Error('Failed to generate OCR extraction across available models.');
    };

    let result: any = null;
    try {
      const response = await Promise.race([runGemini(), timeoutPromise]);
      let rawText = (response?.text || '').trim();
      if (rawText.startsWith('```')) {
        rawText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
      }
      if (rawText.startsWith('[') && rawText.includes(']')) {
        const firstBracket = rawText.indexOf('[');
        const lastBracket = rawText.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
          result = JSON.parse(rawText.substring(firstBracket, lastBracket + 1));
        }
      } else {
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          rawText = rawText.substring(firstBrace, lastBrace + 1);
        }
        result = JSON.parse(rawText || '{}');
      }
    } catch (geminiErr: any) {
      console.warn('Gemini extraction unavailable in ocr:', geminiErr?.message);
      if (extractedPdfText.length >= 20) {
        result = parseOcrTextFallback(extractedPdfText, itemsList || '');
      } else {
        throw geminiErr;
      }
    }

    if (!result) {
      result = { invoiceNumber: '', invoiceDate: '', extractedItems: [] };
    }

    const rawItems = Array.isArray(result)
      ? result
      : Array.isArray(result.extractedItems)
      ? result.extractedItems
      : Array.isArray(result.lineItems)
      ? result.lineItems
      : Array.isArray(result.items)
      ? result.items
      : Array.isArray(result.products)
      ? result.products
      : Array.isArray(result.lines)
      ? result.lines
      : [];

    const normalizedItems = rawItems.map((item: any) => {
      const caseQty = typeof item.deliveredCaseQty === 'number' ? item.deliveredCaseQty : (parseFloat(item.quantity) || 0);
      const packQty = typeof item.deliveredPackQty === 'number' ? item.deliveredPackQty : 0;
      const casePrice = typeof item.invoicedCasePrice === 'number' 
        ? item.invoicedCasePrice 
        : (typeof item.invoicedPriceBox === 'number' ? item.invoicedPriceBox : (parseFloat(item.casePrice) || 0));
      const packPrice = typeof item.invoicedPackPrice === 'number' 
        ? item.invoicedPackPrice 
        : (typeof item.invoicedPriceUnit === 'number' ? item.invoicedPriceUnit : (parseFloat(item.packPrice) || 0));
      const totalPrice = typeof item.totalLinePrice === 'number' 
        ? item.totalLinePrice 
        : (typeof item.invoicedLineTotal === 'number' ? item.invoicedLineTotal : (parseFloat(item.totalPrice) || 0));
      const notes = item.conditionNotes || item.notes || '';

      return {
        matchedOrderName: item.matchedOrderName || item.rawScannedName || '',
        rawScannedName: item.rawScannedName || item.matchedOrderName || '',
        deliveredCaseQty: caseQty,
        deliveredPackQty: packQty,
        invoicedCasePrice: casePrice,
        invoicedPriceBox: casePrice,
        invoicedPackPrice: packPrice,
        invoicedPriceUnit: packPrice,
        totalLinePrice: totalPrice,
        invoicedLineTotal: totalPrice,
        conditionNotes: notes,
        notes: notes,
      };
    });

    return res.status(200).json({
      requestId,
      invoiceNumber: result.invoiceNumber || '',
      invoiceDate: result.invoiceDate || '',
      extractedItems: normalizedItems,
      lineItems: normalizedItems,
    });
  } catch (err: any) {
    if (err instanceof OcrSecurityError) {
      return res.status(err.status).json({ error: err.message, code: err.code, requestId });
    }
    const rawMsg = err?.message || 'Failed to process document OCR.';
    const sanitizedMsg = redactSecrets(rawMsg);
    
    // Distinguish specific failure categories:
    if (sanitizedMsg.includes('timed out')) {
      return res.status(504).json({ 
        error: 'OCR request timed out. Please try a clearer or smaller image/PDF.',
        code: 'ERR_TIMEOUT',
        requestId
      });
    }

    if (sanitizedMsg.includes('429') || sanitizedMsg.includes('RESOURCE_EXHAUSTED') || sanitizedMsg.includes('quota') || sanitizedMsg.includes('Quota exceeded')) {
      return res.status(429).json({
        error: 'OCR provider quota exceeded or rate limit reached. Please retry in a few moments.',
        code: 'ERR_PROVIDER_QUOTA',
        requestId
      });
    }

    if (sanitizedMsg.includes('503') || sanitizedMsg.includes('UNAVAILABLE') || sanitizedMsg.includes('high demand')) {
      return res.status(503).json({
        error: 'OCR provider is temporarily unavailable due to high demand. Please retry shortly.',
        code: 'ERR_PROVIDER_UNAVAILABLE',
        requestId
      });
    }

    if (sanitizedMsg.includes('JSON') || sanitizedMsg.includes('parse') || sanitizedMsg.includes('SyntaxError')) {
      return res.status(502).json({
        error: 'Failed to extract structured data from document.',
        code: 'ERR_EXTRACTION_FAILED',
        requestId
      });
    }

    console.error(`[${requestId}] OCR Error:`, err?.name || 'Error', sanitizedMsg);
    return res.status(500).json({ 
      error: 'Failed to process document OCR. Please verify the document format or try manual entry.',
      code: 'ERR_OCR_INTERNAL',
      requestId
    });
  }
}

/**
 * Intelligent heuristic fallback parser for digital text extracted from cross-check invoice PDFs.
 * Activates if Gemini free-tier quota is temporarily exhausted or rate-limited.
 */
function parseOcrTextFallback(text: string, itemsList: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const targetItems = itemsList
    .split(',')
    .map(i => i.trim())
    .filter(i => i.length > 2);

  const clean = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  let invoiceNumber = '';
  let invoiceDate = '';
  const extractedItems: any[] = [];

  for (const line of lines) {
    if (!invoiceNumber && /(?:invoice|inv|bill|doc|ref|dn)[\s#.:]+([A-Z0-9\-_]{3,})/i.test(line)) {
      const match = line.match(/(?:invoice|inv|bill|doc|ref|dn)[\s#.:]+([A-Z0-9\-_]{3,})/i);
      if (match) invoiceNumber = match[1];
    }
    if (!invoiceDate && /(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/.test(line)) {
      const match = line.match(/(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})/);
      if (match) invoiceDate = match[1];
    }

    // Try finding lines with numbers (qty, price, total)
    const priceMatch = line.match(/^(.*?)\s+(?:([A-Z0-9\-]{3,})\s+)?(\d+(?:\.\d+)?)\s+(?:£|\$|€)?(\d+\.\d{2})\s+(?:£|\$|€)?(\d+\.\d{2})$/i);
    const simpleMatch = line.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s+(?:£|\$|€)?(\d+\.\d{2})$/i);

    let rawDesc = '';
    let qty = 1;
    let price = 0;
    let total = 0;

    if (priceMatch && !/total|subtotal|vat|net|amount|delivery|due/i.test(priceMatch[1])) {
      rawDesc = priceMatch[1].trim();
      qty = parseFloat(priceMatch[3]) || 1;
      price = parseFloat(priceMatch[4]) || 0;
      total = parseFloat(priceMatch[5]) || 0;
    } else if (simpleMatch && !/total|subtotal|vat|net|amount|delivery|due/i.test(simpleMatch[1])) {
      rawDesc = simpleMatch[1].trim();
      qty = parseFloat(simpleMatch[2]) || 1;
      price = parseFloat(simpleMatch[3]) || 0;
      total = qty * price;
    }

    if (rawDesc) {
      // Find closest matched product from targetItems
      const cleanDesc = clean(rawDesc);
      let matchedName = rawDesc;
      let highestScore = 0;

      for (const target of targetItems) {
        const cleanTarget = clean(target);
        if (cleanDesc === cleanTarget || cleanDesc.includes(cleanTarget) || cleanTarget.includes(cleanDesc)) {
          matchedName = target;
          break;
        }
        const targetWords = cleanTarget.split(' ').filter(w => w.length > 2);
        const descWords = cleanDesc.split(' ').filter(w => w.length > 2);
        const overlap = targetWords.filter(w => descWords.includes(w)).length;
        if (overlap > highestScore && overlap >= 1) {
          highestScore = overlap;
          matchedName = target;
        }
      }

      extractedItems.push({
        matchedOrderName: matchedName,
        rawScannedName: rawDesc,
        deliveredCaseQty: qty,
        deliveredPackQty: 0,
        invoicedCasePrice: price,
        invoicedPriceBox: price,
        invoicedPackPrice: 0,
        invoicedPriceUnit: 0,
        totalLinePrice: total,
        invoicedLineTotal: total,
        conditionNotes: '',
        notes: '',
      });
    }
  }

  return { invoiceNumber, invoiceDate, extractedItems };
}

