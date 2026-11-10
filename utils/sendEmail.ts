import { auth } from '../firebase-config.ts';
import type { EmailRequest } from '../shared/email.ts';
import { EmailRequestError, readEmailError } from '../shared/email.ts';

export { EmailRequestError, readEmailError };

/** The SMTP reply address is singular even when a saved contact contains a list. */
export function firstEmailAddress(value: string | undefined): string | undefined {
  return value?.split(',').map(address => address.trim()).find(Boolean);
}

/** Send only the supported message fields; transport credentials stay on the server. */
export async function sendEmail(request: EmailRequest): Promise<Response> {
  const user = auth?.currentUser;
  if (!user) {
    throw new EmailRequestError('Please sign in again before sending email. Your email has not been sent.', 401);
  }

  let token: string;
  try {
    token = await user.getIdToken();
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    const invalidSession = [
      'auth/invalid-user-token', 'auth/user-token-expired', 'auth/invalid-id-token',
      'auth/id-token-expired', 'auth/id-token-revoked', 'auth/user-disabled',
      'auth/user-not-found', 'auth/requires-recent-login', 'auth/invalid-credential',
    ].includes(code);
    throw new EmailRequestError(
      invalidSession
        ? 'Your session is no longer valid. Please sign in again before sending email.'
        : 'Your sign-in could not be verified. Your email has not been sent; please try again when the connection is available.',
      invalidSession ? 401 : 503,
    );
  }
  const { purpose, branchId, supplierId, orderId, routeKey, to, cc, replyTo, subject, html, attachments } = request;
  return fetch('/api/send-email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ purpose, branchId, supplierId, orderId, to, cc, replyTo: firstEmailAddress(replyTo), subject, html, attachments }),
  });
}
