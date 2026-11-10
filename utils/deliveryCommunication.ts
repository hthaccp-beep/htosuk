import {orderReference} from '../shared/order-reference.ts';
import type { OrderRecord, Branch, Supplier, Product } from '../types.ts';
import { generateOrderEmailContent, generateOrderPDF } from './orderEmail.ts';
import { readEmailError, type EmailRequest } from '../shared/email.ts';

export interface DeliveryNotificationResult {
  success: boolean;
  status: 'SENT' | 'FAILED';
  sentAt?: string;
  error?: string;
}

/**
 * Dispatches a formal Delivery Note notification with itemized shortages,
 * unit snapshots, notes, and PDF attachment.
 * Prevents false-positive success reporting on failed HTTP transports.
 */
export async function dispatchDeliveryNoteNotification({
  order,
  branch,
  supplier,
  products,
  recipientEmail,
  sendEmailFn,
}: {
  order: OrderRecord;
  branch: Branch;
  supplier?: Supplier;
  products: Product[];
  recipientEmail: string;
  sendEmailFn?: (req: any) => Promise<Response>;
}): Promise<DeliveryNotificationResult> {
  if (!recipientEmail || !recipientEmail.trim()) {
    return {
      success: false,
      status: 'FAILED',
      error: 'Recipient email address is required for delivery note dispatch.'
    };
  }

  try {
    const isPartial = order.fulfillmentStatus === 'PARTIAL';
    const statusTag = isPartial ? ' [SHORTAGES]' : '';

    const pdfBase64 = await generateOrderPDF(
      order,
      branch,
      supplier,
      products,
      'DELIVERY'
    );

    const { htmlBody } = generateOrderEmailContent(
      order,
      branch,
      supplier,
      products,
      'DELIVERY'
    );

    const emailPayload: EmailRequest = {
      purpose: 'delivery',
      orderId: order.id,
      to: recipientEmail.trim(),
      cc: supplier?.email,
      subject: `Delivery Note: Order #${orderReference(order.id)} - ${branch.name}${statusTag}`,
      html: htmlBody,
      replyTo: supplier?.email || supplier?.contactEmail || undefined,
      attachments: [{
        filename: `DeliveryNote_${orderReference(order.id)}.pdf`,
        content: pdfBase64,
        encoding: 'base64'
      }]
    };

    let response: Response;
    if (sendEmailFn) {
      response = await sendEmailFn(emailPayload);
    } else {
      const { sendEmail } = await import('./sendEmail.ts');
      response = await sendEmail(emailPayload);
    }

    if (!response.ok) {
      const err = await readEmailError(response);
      return {
        success: false,
        status: 'FAILED',
        error: err.message || `HTTP ${response.status} email dispatch failure`
      };
    }

    return {
      success: true,
      status: 'SENT',
      sentAt: new Date().toISOString()
    };
  } catch (err: any) {
    return {
      success: false,
      status: 'FAILED',
      error: err.message || 'Network transport failure dispatching delivery note'
    };
  }
}
