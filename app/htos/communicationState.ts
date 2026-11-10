import type { OrderRecord } from '../../types';
import { readEmailError } from '../../shared/email';
export function emailState(order:Pick<OrderRecord,'status'|'emailStatus'|'emailError'>) {
  if(order.status==='DRAFT')return {label:'Draft',tone:'amber',detail:'This order has not been placed.'};
  if(order.status==='CANCELLED')return {label:'Cancelled',tone:'',detail:'This order was cancelled.'};
  switch(order.emailStatus){
    case 'SENT':return {label:'Email sent',tone:'green',detail:'Accepted by the mail server. Check the branch inbox or spam folder for its copy.'};
    case 'PARTIAL':return {label:'Email partial',tone:'amber',detail:'Some recipients may not have received the email. Check before resending.'};
    case 'UNCERTAIN':return {label:'Email uncertain',tone:'amber',detail:'The server could not confirm delivery. Check the recipient inbox before resending.'};
    case 'FAILED':case 'OFFLINE_MANUAL':return {label:'Email failed',tone:'red',detail:order.emailError||'Email was not sent. Check the branch email settings and retry.'};
    case 'PENDING':return {label:'Email pending',tone:'amber',detail:'Email acceptance has not yet been confirmed.'};
    default:return {label:'Email not sent',tone:'',detail:'The order is saved, but no email has been confirmed.'};
  }
}
export function emailFailureStatus(error:unknown):'FAILED'|'UNCERTAIN' {
  return error instanceof TypeError || (error && typeof error==='object' && 'status' in error && error.status===502)?'UNCERTAIN':'FAILED';
}

/** Keep SMTP acceptance separate from saving its status; a failed save must never trigger a resend. */
export async function sendAndRecordOrderEmail(order:OrderRecord,send:()=>Promise<Response>,save:(patch:Partial<OrderRecord>)=>Promise<unknown>) {
  try {
    const response=await send();
    if(!response.ok)throw await readEmailError(response);
  } catch(error) {
    try {await save({emailStatus:emailFailureStatus(error),emailError:error instanceof Error?error.message:'Email could not be confirmed.',emailRetryCount:(order.emailRetryCount||0)+1});}
    catch {throw new Error('Email could not be confirmed, and its status could not be saved. Check the branch inbox before retrying.');}
    throw error;
  }
  try {await save({emailStatus:'SENT',emailSentAt:new Date().toISOString(),emailError:''});}
  catch {throw new Error('The mail server accepted this email, but HTOS could not save its status. Check the branch inbox before resending.');}
}
