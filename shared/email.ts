export type EmailPurpose = 'order' | 'resend' | 'delivery' | 'credit-claim' | 'price-alert';

export interface EmailAttachment {
  filename: string;
  content: string;
  encoding: 'base64';
}

export interface EmailRequest {
  purpose: EmailPurpose;
  branchId?: string;
  supplierId?: string;
  orderId?: string;
  routeKey?: string;
  to?: string;
  cc?: string;
  replyTo?: string;
  subject: string;
  html: string;
  attachments?: EmailAttachment[];
}

export class EmailRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'EmailRequestError';
    this.status = status;
  }
}

export async function readEmailError(response: Response): Promise<EmailRequestError> {
  const messages: Record<number, string> = {
    400: 'Check the email details and use contacts saved for this supplier or branch.',
    401: 'Your session has expired. Please sign in again before sending email.',
    403: 'You cannot send this email. Use your assigned branch and its saved supplier or branch contacts.',
    413: 'The email attachment is too large. Use a smaller invoice scan and try again.',
    429: 'Too many emails were requested. Please wait before trying again.',
    502: 'The mail server could not confirm the email. Check whether it arrived before resending.',
    503: 'Email sending is unavailable. Ask an administrator to check the server email configuration.',
  };
  let message = messages[response.status] || 'Email was not sent. Please try again or contact an administrator.';
  try {
    const body: unknown = await response.json();
    if (body && typeof body === 'object') {
      const data = body as Record<string, unknown>;
      const detail = typeof data.message === 'string' ? data.message : data.error;
      if (typeof detail === 'string' && detail.trim()) message = detail.slice(0, 600);
    }
  } catch {
    // HTML proxy errors and empty responses still receive an actionable message.
  }
  return new EmailRequestError(message, response.status);
}
