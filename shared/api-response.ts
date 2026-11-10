import {databaseErrorMessage} from './database-errors.ts';
import {catalogueErrorFromResponse} from './catalogue-errors.ts';

/** Hosting errors can be plain text/HTML; never turn them into an empty success. */
export async function readApiResponse(response:Response, action?:string) {
 const data=await response.json().catch(()=>null);
 const valid=!!data&&typeof data==='object'&&!Array.isArray(data);
 if(response.ok&&valid)return data;
 if(valid&&['catalog-preview','catalog-commit'].includes(action||'')){const error=catalogueErrorFromResponse(data);if(error)throw error;}
 if(valid&&typeof data.error==='string'&&data.error.trim())throw new Error(databaseErrorMessage({...data,message:data.error},data.error));
 const stage=action==='catalog-preview'?'The CSV/file preview could not start':action==='catalog-commit'?'The import result could not be confirmed':'The service could not complete this request';
 const advice=response.status===401?'Please sign in again.':response.status===413?'Choose a smaller file, up to 3 MB.':action==='catalog-commit'?'Keep this review open and retry; the same import reference prevents duplicate changes.':'Keep your file or edits, reload HTOS and try again. If this continues, contact the workspace owner.';
 throw new Error(`${stage} (HTTP ${response.status}${response.ok?', unreadable response':''}). ${advice}`);
}
