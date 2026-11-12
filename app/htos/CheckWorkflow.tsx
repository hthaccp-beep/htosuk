import {createContext,useContext} from 'react';
import {api} from './ui';
export const CheckWorkflowContext=createContext<(body:any)=>Promise<any>>(body=>api(body.action==='invoice-case-read'?'/api/admin/invoice-reading':'/api/admin/workspace',body,{notifyChange:!body.action?.startsWith('invoice-case-preparation-')&&!['invoice-case-reading-status','invoice-case-read','invoice-case-receipt-summaries'].includes(body.action)}));
export const useCheckWorkflow=()=>useContext(CheckWorkflowContext);
