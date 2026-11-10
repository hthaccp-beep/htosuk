import {createHash} from 'node:crypto';
import {PRICE_DELETE_LIMIT, priceRecordFingerprint, historyProvesActivation} from '../shared/price-record-removal.ts';
import {PriceOperationError} from './price-change-service.ts';

// Only explicitly reviewed price records are removable. No product/order access.
export async function removePriceRecords(db: any, uid: string, body: any) {
  if (!body || !['notices', 'history'].includes(body.kind)
    || typeof body.requestId !== 'string' || !/^[\w-]{1,60}$/.test(body.requestId) || body.confirmation !== 'DELETE'
    || Object.keys(body).some(k => !['action','kind','rows','requestId','confirmation'].includes(k)))
    throw new PriceOperationError(400, 'Invalid deletion request. Review the records again.');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > PRICE_DELETE_LIMIT
    || body.rows.some((r: any) => !r || typeof r.id !== 'string' || !/^[\w-]{1,220}$/.test(r.id) || typeof r.expected !== 'string' || r.expected.length > 24000)
    || new Set(body.rows.map((r: any) => r.id)).size !== body.rows.length)
    throw new PriceOperationError(400, `Select 1–${PRICE_DELETE_LIMIT} different records per deletion.`);
  const rows = [...body.rows].sort((a,b) => a.id.localeCompare(b.id));
  const payloadHash = createHash('sha256').update(JSON.stringify({kind:body.kind,rows})).digest('hex');
  return db.runTransaction(async (tx: any) => {
    const profile = await tx.get(db.collection('users').doc(uid));
    if (profile.data()?.active !== true || profile.data()?.role !== 'CREATOR')
      throw new PriceOperationError(403, 'Only the workspace owner can permanently delete price records.');
    const receiptRef = db.collection('_price_record_operations').doc(body.requestId);
    const receipt = await tx.get(receiptRef);
    if (receipt.exists) {
      if (receipt.data().uid !== uid || receipt.data().payloadHash !== payloadHash)
        throw new PriceOperationError(409, 'This deletion reference was used for a different selection.');
      return receipt.data().result;
    }
    const collection = body.kind === 'notices' ? 'price_change_notices' : 'price_history';
    const docs = await Promise.all(rows.map(r => tx.get(db.collection(collection).doc(r.id))));
    for (let i = 0; i < docs.length; i++) {
      if (!docs[i].exists || priceRecordFingerprint({...docs[i].data(), id:docs[i].id}) !== rows[i].expected)
        throw new PriceOperationError(409, 'A selected record changed or was deleted. Reload the list and review again. Nothing was deleted.');
    }
    // Legacy approvals may lack activatedAt. Preserve application evidence before
    // deleting their history, so a removed history row cannot re-enable activation.
    const applied = new Map<string, any>();
    if (body.kind === 'history') {
      const histories = docs.map((d:any) => d.data());
      const ids = [...new Set(histories.map((h:any) => h.productId))];
      for (const id of ids) {
        const notices = await tx.get(db.collection('price_change_notices').where('productId','==',id));
        for (const notice of notices.docs) {
          if (!notice.data().activatedAt && histories.some((h:any) => historyProvesActivation(notice.data(),h)))
            applied.set(notice.id, notice.ref);
        }
      }
    }
    if (docs.length + applied.size > 440) throw new PriceOperationError(400, 'Select fewer history records and try again. Nothing was deleted.');
    const now = new Date().toISOString();
    for (const ref of applied.values()) tx.update(ref, {activatedAt:now});
    for (const doc of docs) tx.delete(doc.ref);
    const result = {success:true, deleted:docs.length, kind:body.kind, activatedNoticeIds:[...applied.keys()], activatedAt:now};
    // Minimal deletion receipt, not a hidden copy of the deleted records.
    tx.create(receiptRef, {uid,payloadHash,result,completedAt:now});
    return result;
  });
}
