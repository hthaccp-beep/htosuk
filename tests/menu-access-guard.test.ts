import test from 'node:test';
import assert from 'node:assert/strict';
import {menuAccessChangeError} from '../server/menu-access-guard.ts';
const manager={id:'manager',role:'MANAGER',permissionMode:'CUSTOM',customPermissions:['manage_users'],supplierIds:['s1'],branchIds:['b1'],allBranches:false};
const staff={id:'staff',role:'STAFF',permissionMode:'CUSTOM',customPermissions:['create_orders']};
test('a manager cannot grant Standard Menu permissions to themselves or a staff account',()=>{
  for(const existing of [manager,staff,null])assert.match(menuAccessChangeError(manager,existing,{customPermissions:['view_menu_recipes']})||'',/owner or GM/);
});
test('self-service cannot expand permissions or supplier/branch scope',()=>{
  for(const patch of [{supplierIds:['s1','s2']},{allSuppliers:true},{allBranches:true},{branchIds:['b1','b2']},{customPermissions:['manage_users','manage_roles']},{permissionMode:'INHERITED'}])assert.ok(menuAccessChangeError(manager,manager,patch));
});
test('staff account inheritance cannot be switched by a manager to bypass a custom access restriction',()=>{
  assert.ok(menuAccessChangeError(manager,staff,{permissionMode:'INHERITED'}));
});
test('ordinary edits and unchanged access remain available; owner and GM may manage Menu access',()=>{
  assert.equal(menuAccessChangeError(manager,manager,{displayName:'Updated',supplierIds:['s1'],customPermissions:['manage_users']}),null);
  assert.equal(menuAccessChangeError(manager,staff,{customPermissions:['create_orders','edit_drafts']}),null);
  assert.equal(menuAccessChangeError(manager,null,{role:'STAFF',permissionMode:'CUSTOM',customPermissions:['create_orders']}),null);
  for(const role of ['CREATOR','GM'])assert.equal(menuAccessChangeError({id:'admin',role},staff,{customPermissions:['view_menu_recipes','approve_menu_recipes']}),null);
});
