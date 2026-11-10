import type {Firestore, Transaction} from 'firebase-admin/firestore';
import type {Recipe, RecipeContent, ProductChoice} from '../shared/menu-recipes.ts';
import {recipeGaps} from '../shared/menu-recipes.ts';
import {hasSupplierScope, assignedBranches} from '../shared/order-scope.ts';
import {checkUserActionPermission, type AuthenticatedUser} from './order-authorization.ts';
import {MenuError, menuId, textValue, validateRecipe, validateSpecification, digest} from './menu-validation.ts';

const recipes = 'menu_recipes';
type Context = {db: Firestore; tx: Transaction; user: AuthenticatedUser; roles: Record<string,string[]>};
function requirePermission(ctx: Context, action: string) {
  if (!checkUserActionPermission(ctx.user, 'view_menu_recipes', ctx.roles) || !checkUserActionPermission(ctx.user, action, ctx.roles)) throw new MenuError('Your account does not have access to this Menu & Recipes action.', 403);
}
function supplierAccess(user: AuthenticatedUser, supplierId: string) {
  if (!hasSupplierScope(user, supplierId)) throw new MenuError('This supplier is outside your account’s access.', 403);
}
function branchAccess(user: AuthenticatedUser, product: any) {
  const branches = assignedBranches(user);
  return !product.allowedBranchIds?.length || branches === null || branches.some(id => product.allowedBranchIds.includes(id));
}
const summary = (r: Recipe) => ({id:r.id, code:r.code, name:r.name, category:r.category, kind:r.kind, version:r.version, status:r.status, updatedAt:r.updatedAt});

// Resolve only this recipe's dependencies; no full product or recipe collection scan.
async function resolve(ctx: Context, input: RecipeContent) {
  const cache = new Map<string, any>();
  const read = async (path: string) => {
    if (!cache.has(path)) {
      if (cache.size >= 250) throw new MenuError('This recipe has too many linked records. Split it into smaller preparation recipes.');
      const snap = await ctx.tx.get(ctx.db.doc(path));
      cache.set(path, snap.exists ? snap.data() : null);
    }
    return cache.get(path);
  };
  const visit = async (recipe: RecipeContent, ancestors: Set<string>, depth: number): Promise<{recipe:RecipeContent; hash:string; issues:string[]}> => {
    if (ancestors.has(recipe.id) || depth > 10) throw new MenuError('Preparation recipes cannot link in a circle or more than ten levels deep.');
    const next = new Set(ancestors).add(recipe.id);
    const copy: RecipeContent = structuredClone(recipe);
    const dependencies: unknown[] = [];
    const issues: string[] = [];
    for (const row of copy.ingredients) {
      if (row.source === 'preparation' && row.preparationId) {
        const child = await read(`${recipes}/${row.preparationId}`) as Recipe | null;
        if (!child || child.kind !== 'preparation') { issues.push(`${row.name}: preparation recipe is missing or is not a preparation.`); dependencies.push(['missing', row.preparationId]); continue; }
        const nested = await visit({...child,id:row.preparationId}, next, depth + 1);
        row.preparationName = `${child.code} · ${child.name}`;
        dependencies.push(['recipe', row.preparationId, child.version, nested.hash]);
        if (child.status !== 'approved' || child.dependencyHash !== nested.hash || nested.issues.length) issues.push(`${row.name}: linked preparation needs recipe approval or review.`);
        issues.push(...nested.issues);
      }
      for (const choice of [row.preferred, ...row.alternatives].filter(Boolean) as ProductChoice[]) {
        supplierAccess(ctx.user, choice.supplierId);
        const product = await read(`products/${choice.productId}`);
        const supplier = await read(`suppliers/${choice.supplierId}`);
        const evidence = await read(`menu_product_evidence/${choice.productId}`);
        if (product && !branchAccess(ctx.user, product)) throw new MenuError('A linked product is outside your branch access.', 403);
        if (!product || product.supplierId !== choice.supplierId || product.active !== true || supplier?.active !== true) {
          issues.push(`${row.name}: ${choice.productName || choice.productId} is missing, inactive or has changed supplier.`);
          dependencies.push(['unavailable', choice.productId, choice.supplierId]);
          continue;
        }
        Object.assign(choice, {productName:product.name, supplierName:supplier.name, itemCode:product.itemCode || '', packSize:product.packSize || ''});
        // Prices are deliberately absent: this module does not yet calculate recipe costs.
        dependencies.push(['product', choice.productId, choice.supplierId, product.name, product.itemCode || '', product.packSize || '', supplier.name, product.allowedBranchIds || [], evidence?.revision || 0]);
      }
    }
    return {recipe:copy, hash:digest(dependencies), issues:[...new Set(issues)]};
  };
  return visit(input, new Set(), 0);
}
async function productFor(ctx: Context, productId: string) {
  const snap = await ctx.tx.get(ctx.db.doc(`products/${productId}`));
  const product = snap.data();
  if (!product) throw new MenuError('This catalogue product no longer exists.', 404);
  supplierAccess(ctx.user, product.supplierId);
  if (!branchAccess(ctx.user, product)) throw new MenuError('This product is outside your branch access.', 403);
  return product;
}
function expectedVersion(body: any, current: Recipe | undefined) {
  if (!Number.isInteger(body.expectedVersion) || body.expectedVersion !== (current?.version || 0)) throw new MenuError('This recipe changed elsewhere. Reopen it before saving; your current edits have not been overwritten.', 409);
}

export async function menuAction(db: Firestore, uid: string, body: any) {
  const supported = ['menu-bootstrap','menu-list','menu-get','menu-products','menu-save','menu-approve','menu-history','menu-spec-list','menu-spec-upload','menu-spec-download'];
  if (!body || !supported.includes(body.action)) throw new MenuError('Unknown Menu & Recipes action.');
  const action = body.action as string;
  // Validate payloads before starting reads, but always authorise before returning data or writes.
  const content = action === 'menu-save' ? validateRecipe(body.recipe) : null;
  const upload = action === 'menu-spec-upload' ? validateSpecification(body) : null;
  return db.runTransaction(async tx => {
    const profile = (await tx.get(db.doc(`users/${uid}`))).data();
    const roles = (await tx.get(db.doc('settings/role_permissions'))).data()?.map || {};
    const ctx: Context = {db, tx, user:{...profile,id:uid} as AuthenticatedUser, roles};
    requirePermission(ctx, 'view_menu_recipes');
    if (action === 'menu-bootstrap') {
      let query = db.collection('suppliers').orderBy('__name__').limit(100);
      if (body.cursor) query = query.startAfter(menuId(body.cursor));
      const page = await tx.get(query);
      const permissions = ['view_menu_recipes','edit_menu_recipes','approve_menu_recipes','manage_product_specs'].filter(p => checkUserActionPermission(ctx.user,p,roles));
      return {account:{id:uid,displayName:ctx.user.displayName || 'HTOS user',permissions},suppliers:page.docs.filter(d => d.data().active === true && hasSupplierScope(ctx.user,d.id)).map(d => ({id:d.id,name:d.data().name})),cursor:page.size === 100 ? page.docs.at(-1)!.id : null};
    }
    if (action === 'menu-list') {
      let query = db.collection(recipes).orderBy('__name__').limit(40).select('code','name','category','kind','version','status','updatedAt');
      if (body.cursor) query = query.startAfter(menuId(body.cursor));
      const page = await tx.get(query);
      return {recipes:page.docs.map(d => summary({...d.data(),id:d.id} as Recipe)), cursor:page.size === 40 ? page.docs.at(-1)!.id : null};
    }
    if (action === 'menu-products') {
      const supplierId = menuId(body.supplierId); supplierAccess(ctx.user, supplierId);
      const supplier = (await tx.get(db.doc(`suppliers/${supplierId}`))).data();
      if (supplier?.active !== true) throw new MenuError('Choose an active supplier.');
      let query = db.collection('products').where('supplierId','==',supplierId).orderBy('__name__').limit(60);
      if (body.cursor) query = query.startAfter(menuId(body.cursor));
      const page = await tx.get(query);
      return {products:page.docs.filter(d => d.data().active === true && branchAccess(ctx.user,d.data())).map(d => {
        const p = d.data(); return {id:d.id, supplierId, name:p.name, itemCode:p.itemCode || '', packSize:p.packSize || ''};
      }), cursor:page.size === 60 ? page.docs.at(-1)!.id : null};
    }
    if (action.startsWith('menu-spec-')) {
      const productId = menuId(body.productId);
      const product = await productFor(ctx, productId);
      if (action === 'menu-spec-list') {
        let query = db.collection('menu_product_specs').where('productId','==',productId).orderBy('__name__').limit(20);
        if (body.cursor) query = query.startAfter(menuId(body.cursor));
        const page = await tx.get(query);
        return {specifications:page.docs.map(d => {const {chunks,...meta} = d.data(); return {...meta,id:d.id};}), cursor:page.size === 20 ? page.docs.at(-1)!.id : null};
      }
      if (action === 'menu-spec-download') {
        const id = menuId(body.id);
        const meta = (await tx.get(db.doc(`menu_product_specs/${id}`))).data();
        if (!meta || meta.productId !== productId || meta.supplierId !== product.supplierId) throw new MenuError('The specification is not attached to this supplier product.', 404);
        const chunks = [];
        for (let i=0; i<meta.chunks; i++) {
          const data = (await tx.get(db.doc(`menu_product_specs/${id}/chunks/${i}`))).data();
          if (!data?.base64) throw new MenuError('The specification file is incomplete. Contact your administrator.', 409);
          chunks.push(data.base64);
        }
        const base64 = chunks.join('');
        if (validateSpecification({...meta,base64}).checksum !== meta.checksum) throw new MenuError('The stored specification failed its integrity check. Contact your administrator.',409);
        return {fileName:meta.fileName,mime:meta.mime,base64};
      }
      requirePermission(ctx, 'manage_product_specs');
      if (product.active !== true) throw new MenuError('Upload specifications to an active catalogue product.');
      const supplier = (await tx.get(db.doc(`suppliers/${product.supplierId}`))).data();
      if (supplier?.active !== true) throw new MenuError('The product’s supplier is inactive.');
      const id = menuId(body.requestId);
      const ref = db.doc(`menu_product_specs/${id}`);
      const existing = (await tx.get(ref)).data();
      const evidenceRef = db.doc(`menu_product_evidence/${productId}`);
      const evidence = (await tx.get(evidenceRef)).data();
      const {base64,...file} = upload!;
      const fingerprint = digest([uid,productId,file]);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new MenuError('This upload reference was already used. Select the file again.',409);
        return {id};
      }
      const parts = base64.match(/.{1,480000}/g)!;
      tx.create(ref,{...file,id,productId,supplierId:product.supplierId,uploadedBy:uid,uploadedByName:ctx.user.displayName || uid,
        uploadedAt:new Date().toISOString(),status:'unreviewed',chunks:parts.length,fingerprint});
      parts.forEach((part,index) => tx.create(db.doc(`menu_product_specs/${id}/chunks/${index}`),{base64:part}));
      tx.set(evidenceRef,{revision:(evidence?.revision || 0)+1,updatedAt:new Date().toISOString()});
      return {id};
    }
    const id = content?.id || menuId(body.id);
    const ref = db.doc(`${recipes}/${id}`);
    const current = (await tx.get(ref)).data() as Recipe | undefined;
    if (action === 'menu-get' || action === 'menu-history') {
      if (!current) throw new MenuError('This recipe could not be found.',404);
      const resolved = await resolve(ctx,current);
      if (action === 'menu-history') {
        const page = await tx.get(ref.collection('versions').orderBy('version','desc').limit(20).select('version','status','updatedAt','updatedByName'));
        return {versions:page.docs.map(d => d.data())};
      }
      return {recipe:current,sourceChanged:current.dependencyHash !== resolved.hash,issues:resolved.issues};
    }
    requirePermission(ctx, action === 'menu-approve' ? 'approve_menu_recipes' : 'edit_menu_recipes');
    if (current && content) await resolve(ctx,current); // Enforce access to the existing recipe, even if the payload removes its sources.
    const requestId = menuId(body.requestId);
    const requestRef = db.doc(`menu_requests/${uid}_${requestId}`);
    const previous = (await tx.get(requestRef)).data();
    const fingerprint = digest([action,id,body.expectedVersion,content]);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new MenuError('This save reference was already used for different changes.',409);
      return {id,version:previous.version};
    }
    expectedVersion(body,current);
    if (current && content && (content.code !== current.code || content.kind !== current.kind)) throw new MenuError('A saved recipe’s code and type cannot change. Create a new recipe for a new identity.');
    const candidate = content || current;
    if (!candidate) throw new MenuError('Save the recipe before approving it.');
    const codeRef = db.doc(`menu_recipe_codes/${candidate.code}`);
    const code = (await tx.get(codeRef)).data();
    if (code && code.recipeId !== id) throw new MenuError('This recipe code is already used. Open that recipe or choose a different code.',409);
    const resolved = await resolve(ctx,candidate);
    if (action === 'menu-approve') {
      if (body.expectedDependencyHash !== resolved.hash || current?.dependencyHash !== resolved.hash) throw new MenuError('A supplier product, specification or preparation changed. Review the links and save a new draft before approval.',409);
      const gaps = [...recipeGaps(candidate), ...resolved.issues];
      if (gaps.length) throw new MenuError('Complete the recipe before approval: ' + gaps.slice(0,4).join(' '));
    } else if (resolved.issues.some(s => s.includes('missing, inactive') || s.includes('is missing or'))) {
      throw new MenuError(resolved.issues.join(' '));
    }
    const now = new Date().toISOString();
    const saved: Recipe = {...resolved.recipe,version:(current?.version || 0)+1,status:action === 'menu-approve' ? 'approved' : 'draft',
      allergenStatus:'not_reviewed',updatedAt:now,updatedBy:uid,updatedByName:ctx.user.displayName || uid,
      approvedAt:action === 'menu-approve' ? now : '',approvedByName:action === 'menu-approve' ? ctx.user.displayName || uid : '',dependencyHash:resolved.hash};
    if (Buffer.byteLength(JSON.stringify(saved)) > 700000) throw new MenuError('The recipe is too large. Reduce the photograph size or notes.');
    tx.set(codeRef,{recipeId:id});
    tx.set(ref,saved);
    tx.create(ref.collection('versions').doc(String(saved.version).padStart(8,'0')),saved);
    tx.create(requestRef,{fingerprint,version:saved.version,createdAt:now});
    return {id,version:saved.version};
  });
}
