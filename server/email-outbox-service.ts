import type { EmailOutboxItem, OrderRecord, Branch, Supplier, CreditNoteClaim } from '../types.ts';

export {renderPurchaseOrderEmail as renderAuthoritativeOrderEmailHtml} from '../shared/order-email-template.ts';

/**
 * Server-Side Authoritative Credit Claim Email HTML Renderer.
 */
export function renderCreditClaimEmailHtml(
  claim: CreditNoteClaim,
  branch?: Branch,
  supplier?: Supplier
): string {
  const branchName = branch?.name || 'Hare & Tortoise Branch';
  const supplierName = supplier?.name || 'Supplier Accounts';

  const itemsRows = claim.items.map((item, idx) => `
    <tr style="border-bottom: 1px solid #fecaca; ${idx % 2 === 1 ? 'background-color: #fef2f2;' : ''}">
      <td style="padding: 8px 10px; font-size: 12px; font-family: monospace;">${item.itemCode || '—'}</td>
      <td style="padding: 8px 10px; font-weight: 600; font-size: 13px;">${item.description}</td>
      <td style="padding: 8px 10px; font-size: 12px; text-align: center; color: #b91c1c; font-weight: bold;">${item.issueType.replace('_', ' ')}</td>
      <td style="padding: 8px 10px; font-size: 12px; text-align: center;">${item.orderedQtyStr} / ${item.deliveredQtyStr}</td>
      <td style="padding: 8px 10px; font-size: 13px; text-align: right; font-weight: bold; color: #991b1b;">£${item.claimAmount.toFixed(2)}</td>
    </tr>
  `).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><title>Credit Claim Notice - ${claim.cnRef}</title></head>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; padding: 24px; color: #0f172a;">
      <div style="max-width: 640px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #fee2e2; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background-color: #991b1b; padding: 18px 24px; color: #ffffff;">
          <h2 style="margin: 0; font-size: 18px;">HARE & TORTOISE • SUPPLIER CREDIT CLAIM</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">Notice Reference: <b>${claim.cnRef}</b></p>
        </div>
        <div style="padding: 16px 24px; background-color: #fef2f2; border-bottom: 1px solid #fee2e2;">
          <p style="margin: 0; font-size: 13px; color: #7f1d1d;">
            Dear <b>${supplierName} Accounts</b>,<br>
            Please find attached the formal credit claim for invoice <b>${claim.invoiceNumber || 'Delivery Docket'}</b>.
          </p>
          <p style="margin: 8px 0 0; font-size: 15px; font-weight: bold; color: #991b1b;">
            Total Claim Requested: £${claim.totalClaimAmount.toFixed(2)}
          </p>
        </div>
        <div style="padding: 16px 24px;">
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="background-color: #fee2e2; color: #991b1b; font-size: 11px; text-transform: uppercase;">
                <th style="padding: 8px 10px;">Code</th>
                <th style="padding: 8px 10px;">Item</th>
                <th style="padding: 8px 10px; text-align: center;">Discrepancy</th>
                <th style="padding: 8px 10px; text-align: center;">Ord / Del</th>
                <th style="padding: 8px 10px; text-align: right;">Claim (£)</th>
              </tr>
            </thead>
            <tbody>
              ${itemsRows}
            </tbody>
          </table>
          ${claim.notes ? `
            <div style="margin-top: 16px; padding: 10px 14px; background: #f8fafc; border-radius: 6px; font-size: 12px; color: #475569;">
              <b>Claim Comments:</b> ${claim.notes}
            </div>
          ` : ''}
        </div>
        <div style="padding: 14px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 11px; color: #64748b; text-align: center;">
          Claiming Unit: <b>${branchName}</b> • Hare & Tortoise Restaurant Group • Official Credit Note Attached
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Calculates exponential backoff delay for outbox retries.
 * Attempt 1: 60s
 * Attempt 2: 300s (5m)
 * Attempt 3: 900s (15m)
 */
export function calculateNextRetryDelaySeconds(retryCount: number): number {
  switch (retryCount) {
    case 0:
      return 60; // 1 minute
    case 1:
      return 300; // 5 minutes
    case 2:
      return 900; // 15 minutes
    default:
      return 1800; // 30 minutes cap
  }
}

/**
 * Stable Purpose Key Generator for per-order/version idempotency.
 */
export function generatePurposeKey(orderId: string, version = 1, purpose = 'order'): string {
  return `order_${orderId}_v${version}_${purpose}`;
}

/**
 * Creates an initial outbox queue record with idempotency key.
 */
export function createOutboxItemRecord(params: {
  orderId?: string;
  orderVersion?: number;
  purposeKey?: string;
  type: EmailOutboxItem['type'];
  recipientEmail: string;
  ccEmails?: string[];
  actualSender?: string;
  subject: string;
  html?: string;
  pdfBase64?: string;
  pdfFileName?: string;
  status?: EmailOutboxItem['status'];
  idempotencyKey: string;
}): EmailOutboxItem {
  const now = new Date().toISOString();
  const version = params.orderVersion || 1;
  const purposeKey = params.purposeKey || (params.orderId ? generatePurposeKey(params.orderId, version) : params.idempotencyKey);

  return {
    id: `outbox_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    orderId: params.orderId,
    orderVersion: version,
    purposeKey,
    type: params.type,
    recipientEmail: params.recipientEmail,
    ccEmails: params.ccEmails || [],
    actualSender: params.actualSender,
    subject: params.subject,
    html: params.html,
    pdfBase64: params.pdfBase64,
    pdfFileName: params.pdfFileName,
    status: params.status || 'PENDING',
    retryCount: 0,
    maxRetries: 3,
    nextAttemptAt: now,
    createdAt: now,
    idempotencyKey: params.idempotencyKey,
    acceptedRecipients: [],
    rejectedRecipients: [],
  };
}

export interface DeliveryResult {
  accepted: string[];
  rejected: string[];
  messageId?: string;
}

export interface ProcessOutboxOptions {
  sendMailFn: (item: EmailOutboxItem) => Promise<DeliveryResult>;
  fallbackMailFn?: (item: EmailOutboxItem) => Promise<DeliveryResult>;
  allowCentralFallback?: boolean;
}

/**
 * Robust transactional outbox processor item handler (R04).
 * - Enforces stable purpose key & idempotency.
 * - Records accepted/rejected recipients, actual sender, message ID.
 * - Handles states: QUEUED, SENDING, ACCEPTED, PARTIAL, FAILED, UNCERTAIN.
 * - CRITICAL: After ambiguous SMTP timeout, does NOT automatically retry or fallback.
 * - Central fallback only for a confirmed pre-acceptance connection failure under explicit policy.
 * - Never resends to an accepted supplier recipient to repair a failed CC.
 */
export async function processOutboxItem(
  item: EmailOutboxItem,
  options: ProcessOutboxOptions
): Promise<EmailOutboxItem> {
  // If already accepted or uncertain, do not re-process
  if (item.status === 'ACCEPTED' || item.status === 'UNCERTAIN') {
    return item;
  }

  item.status = 'SENDING';
  item.processedAt = new Date().toISOString();

  try {
    const result = await options.sendMailFn(item);
    const accepted = (result.accepted || []).map(a => a.toLowerCase());
    const rejected = (result.rejected || []).map(r => r.toLowerCase());
    const supplierRecipient = item.recipientEmail.toLowerCase();

    item.acceptedRecipients = accepted;
    item.rejectedRecipients = rejected;
    item.messageId = result.messageId;

    const supplierAccepted = accepted.includes(supplierRecipient);

    if (supplierAccepted) {
      if (rejected.length > 0) {
        // Supplier copy was accepted, but a CC failed: mark as PARTIAL.
        // DO NOT resend or retry the entire message, as that would duplicate the supplier copy!
        item.status = 'PARTIAL';
      } else {
        item.status = 'ACCEPTED';
      }
    } else {
      // Supplier was not accepted
      item.status = 'FAILED';
      item.error = 'Mail server did not accept the primary supplier recipient.';
    }

    return item;
  } catch (error: any) {
    const errorMsg = String(error?.message || error || '');
    const isTimeout = /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(errorMsg);

    if (isTimeout) {
      // Ambiguous SMTP timeout: The mail server might have already received and dispatched the email.
      // MUST NOT automatically retry or fallback to prevent duplicate orders to supplier!
      item.status = 'UNCERTAIN';
      item.error = 'SMTP delivery timed out after transmission started. Delivery status is uncertain; manual verification required.';
      return item;
    }

    // Check for confirmed pre-acceptance failure (e.g. auth failed 535, connection refused before envelope/data)
    const isPreAcceptanceFailure = /535|authentication failed|connection refused|ECONNREFUSED/i.test(errorMsg);

    if (isPreAcceptanceFailure && options.allowCentralFallback && options.fallbackMailFn) {
      try {
        const fallbackResult = await options.fallbackMailFn(item);
        const accepted = (fallbackResult.accepted || []).map(a => a.toLowerCase());
        const rejected = (fallbackResult.rejected || []).map(r => r.toLowerCase());
        const supplierRecipient = item.recipientEmail.toLowerCase();

        item.acceptedRecipients = accepted;
        item.rejectedRecipients = rejected;
        item.messageId = fallbackResult.messageId;

        if (accepted.includes(supplierRecipient)) {
          item.status = rejected.length > 0 ? 'PARTIAL' : 'ACCEPTED';
        } else {
          item.status = 'FAILED';
          item.error = 'Fallback mail server did not accept primary recipient.';
        }
        return item;
      } catch (fallbackErr: any) {
        item.status = 'FAILED';
        item.error = `Primary failure (${errorMsg}) and fallback failure (${fallbackErr?.message || fallbackErr})`;
        return item;
      }
    }

    // Otherwise standard failure
    item.status = 'FAILED';
    item.error = errorMsg;
    item.retryCount = (item.retryCount || 0) + 1;
    return item;
  }
}

