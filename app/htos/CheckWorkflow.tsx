import {createContext,useContext} from 'react';
import {api} from './ui';
export const CheckWorkflowContext=createContext<(body:any)=>Promise<any>>(body=>api('/api/admin/workspace',body));
export const useCheckWorkflow=()=>useContext(CheckWorkflowContext);
