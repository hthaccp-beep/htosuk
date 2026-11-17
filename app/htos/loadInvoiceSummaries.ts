import type {InvoiceReceiptSummary} from '../../shared/invoice-receipt-summary';

type Request = (body: {action: string; orderIds: string[]}, options?: {signal?: AbortSignal}) => Promise<{summaries: InvoiceReceiptSummary[]}>;
export type SummaryProgress = {summaries: Record<string, InvoiceReceiptSummary>; completed: number};

/** Read only the supplied orders. Publish each batch; never retry automatically. */
export async function loadInvoiceSummaries(request: Request, orderIds: string[], signal: AbortSignal, onProgress: (progress: SummaryProgress) => void, timeoutMs = 15000) {
 const ids = [...new Set(orderIds)];
 const summaries: Record<string, InvoiceReceiptSummary> = {};
 for (let start = 0; start < ids.length; start += 20) {
  signal.throwIfAborted();
  const batch = ids.slice(start, start + 20), controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, {once: true});
  let rejectAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_, reject) => {
   rejectAbort = () => reject(controller.signal.reason);
   controller.signal.addEventListener('abort', rejectAbort, {once: true});
  });
  const timer = setTimeout(() => controller.abort(new Error('Invoice status request timed out.')), timeoutMs);
  try {
   const result = await Promise.race([request({action: 'invoice-case-receipt-summaries', orderIds: batch}, {signal: controller.signal}), cancelled]);
   controller.signal.throwIfAborted();
   if (!Array.isArray(result?.summaries) || result.summaries.some(s => !s || !batch.includes(s.id))) throw new Error('Invoice statuses could not be read.');
   for (const summary of result.summaries) summaries[summary.id] = summary;
   onProgress({summaries: {...summaries}, completed: start + batch.length});
  } finally {
   clearTimeout(timer);
   signal.removeEventListener('abort', abort);
   if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
 }
}
