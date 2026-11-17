import {createContext,useContext} from 'react';
import {api} from './ui';
export const CheckWorkflowContext=createContext<(body:any,options?:{signal?:AbortSignal})=>Promise<any>>((body,options)=>api(body.action==='invoice-case-read'?'/api/admin/invoice-reading':'/api/admin/workspace',body,{signal:options?.signal,notifyChange:!body.action?.startsWith('invoice-case-preparation-')&&!['invoice-case-reading-status','invoice-case-read','invoice-case-receipt-summaries'].includes(body.action)}));
export const useCheckWorkflow=()=>useContext(CheckWorkflowContext);
