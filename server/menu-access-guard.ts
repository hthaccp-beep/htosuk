// Shared account administration must not let a local manager grant themselves Menu access.
const menuPermissions = new Set(['view_menu_recipes','edit_menu_recipes','approve_menu_recipes','manage_product_specs']);
type Profile = {id?:string;role:string;permissionMode?:unknown;customPermissions?:unknown;[key:string]:unknown};
function permissions(value:unknown) {return Array.isArray(value)?[...new Set(value.filter(v=>typeof v==='string'))].sort():[];}
function mode(profile:Profile) {return profile.permissionMode==='CUSTOM'||profile.permissionMode!=='INHERITED'&&permissions(profile.customPermissions).length?'CUSTOM':'INHERITED';}
function same(a:unknown,b:unknown) {return JSON.stringify(Array.isArray(a)?permissions(a):a??null)===JSON.stringify(Array.isArray(b)?permissions(b):b??null);}
export function menuAccessChangeError(requester:Profile,existing:Profile|null,patch:Record<string,unknown>):string|null {
  if(['CREATOR','GM'].includes(requester.role))return null;
  const next={...(existing||{role:'STAFF'}),...patch} as Profile;
  if(existing&&requester.id===existing.id){
    const scopeKeys=['allBranches','branchIds','allSuppliers','supplierIds','allDepartments','departmentIds'];
    if(scopeKeys.some(key=>key in patch&&!same(existing[key],patch[key]))||
       ('customPermissions' in patch&&!same(permissions(existing.customPermissions),permissions(patch.customPermissions)))||
       ('permissionMode' in patch&&mode(existing)!==mode(next)))return 'Ask the workspace owner or GM to change your access permissions or scope.';
  }
  const before=permissions(existing?.customPermissions).filter(p=>menuPermissions.has(p));
  const after=permissions(next.customPermissions).filter(p=>menuPermissions.has(p));
  if(!same(before,after)||existing&&'permissionMode' in patch&&mode(existing)!==mode(next))return 'Only the workspace owner or GM can change Standard Menu permissions or permission inheritance.';
  return null;
}
