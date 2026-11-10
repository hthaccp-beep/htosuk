import {test} from 'node:test';
import assert from 'node:assert/strict';
import {authorizeWorkspaceAction,safeBackupRecord} from '../server/workspace-admin-service.ts';
import {restoreFingerprint,validateRestoreRecord} from '../server/configuration-restore-service.ts';
import {sanitizeAuditDetails} from '../server/audit-log-service.ts';

test('inactive and anonymous accounts cannot access backups or audit history',()=>{
 for(const action of ['backup','audit','status'])for(const user of [null,{role:'CREATOR',active:false},{role:'STAFF',active:true}])assert.equal(authorizeWorkspaceAction(user,action),false);
});
test('workspace permissions use custom mode without falling back to the role',()=>{
 assert.equal(authorizeWorkspaceAction({active:true,role:'REVIEWER',permissionMode:'CUSTOM',customPermissions:[]},'audit',{REVIEWER:['admin_access','view_audit_logs']}),false);
 assert.equal(authorizeWorkspaceAction({active:true,role:'REVIEWER'},'audit',{REVIEWER:['admin_access','view_audit_logs']}),true);
 assert.equal(authorizeWorkspaceAction({active:true,role:'CREATOR'},'unknown'),false);
});
test('backups and audit payloads scrub secrets inside nested arrays',()=>{
 const input={id:'a',password:'s',history:[{accessToken:'t',email:'example@example.invalid',nested:[{smtpPass:'p'}]}]};
 const safe=safeBackupRecord(input);assert.equal(safe.password,undefined);assert.equal(safe.history[0].accessToken,'[REDACTED]');assert.equal(safe.history[0].nested[0].smtpPass,'[REDACTED]');assert.equal(input.password,'s');
 assert.equal(sanitizeAuditDetails(input).history[0].email,'example@example.invalid');
});
test('restore fingerprints ignore key order but detect all stored-value changes',()=>{
 assert.equal(restoreFingerprint({a:1,b:{x:2,y:3}}),restoreFingerprint({b:{y:3,x:2},a:1}));
 assert.notEqual(restoreFingerprint({a:1}),restoreFingerprint({a:2}));
 assert.notEqual(restoreFingerprint(null),restoreFingerprint({}));
});
test('configuration restore rejects accounts, order history and private collections',()=>{
 for(const collection of ['users','orders','_branch_email_settings','_audit_logs'])assert.throws(()=>validateRestoreRecord(collection,{id:'x',name:'x'}));
 assert.throws(()=>validateRestoreRecord('branches',{id:'a/b',name:'x'}));
 assert.throws(()=>validateRestoreRecord('settings',{id:'role_permissions',map:{STAFF:['invented_permission']}}));
});
test('restore cannot enable delivery or install SMTP credentials through settings',()=>{
 assert.deepEqual(validateRestoreRecord('settings',{id:'email_config',fromName:'HTOS',enabled:true,smtpPass:'secret',smtpHost:'x'}),{id:'email_config',fromName:'HTOS'});
 assert.equal(validateRestoreRecord('roles',{id:'STAFF',name:'Staff',isSystem:false}).isSystem,true);
 assert.equal(validateRestoreRecord('roles',{id:'CUSTOM',name:'Team',isSystem:true}).isSystem,false);
});
