import {DEFAULT_ROLE_PERMISSIONS} from '../constants.ts';
import {sanitizeAuditDetails} from './audit-log-service.ts';

export function authorizeWorkspaceAction(user:any,action:string,rolePermissions:Record<string,string[]>={}) {
 if(!user||user.active!==true) return false;
 if(!['status','audit','backup'].includes(action))return false;
 if(['CREATOR','GM'].includes(user.role))return true;
 const permissions=user.permissionMode==='CUSTOM'?user.customPermissions||[]:rolePermissions[user.role]||(DEFAULT_ROLE_PERMISSIONS as any)[user.role]||[];
 const required=action==='backup'?'manage_data':action==='audit'?'view_audit_logs':'manage_email_config';
 return permissions.includes('admin_access')&&permissions.includes(required);
}
export function safeBackupRecord(record:Record<string,any>){
 const safe=sanitizeAuditDetails(record);
 for(const key of Object.keys(safe))if(safe[key]==='[REDACTED]')delete safe[key];
 return safe;
}
