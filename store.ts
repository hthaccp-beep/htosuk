import {canReviewInvoices} from './shared/invoice-case';
import {readProtectedRecords} from './utils/secureRead';
import {supplierRemoval,categoryRemoval} from './shared/catalogue-removal.ts';
import {savedListOrder,planListMove,nextListPosition,canArrangeSuppliers} from './shared/list-order.ts';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User, Branch, Supplier, Category, Product, OrderRecord, CartItem, ManualOrderItem, RolePermissions, Permission, RoleDefinition, EmailConfig, ToastMessage, PriceChangeNotice, NewItemNotice, PriceHistoryRecord, PriceMonitoringSettings, Department } from './types.ts';
import {validateSupplierMinimum} from './shared/order-minimum';
import { DEFAULT_ROLE_PERMISSIONS, LIVE_SYNC_DAYS, DEFAULT_PRICE_MONITORING_SETTINGS, SEED_DEPARTMENTS } from './constants.ts';
import { db, auth } from './firebase-config.ts';
import { collection, addDoc, updateDoc, deleteDoc, doc, setDoc, getDocs, query, where, orderBy, writeBatch } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { incomingOrderSupplierIds, historyOrderPartitions, orderScopeKey } from './shared/order-scope.ts';
import {coalescePending} from './shared/pending-request.ts';
import { scopedOrderQuery } from './utils/orderQueries.ts';

let supplierOrderSaving=false;

export interface AppState {
  // Auth State (Managed by Firebase Auth Listener in App.tsx)
  currentUser: User | null;
  setCurrentUser: (user: User | null) => void;
  logout: () => Promise<void>;
  
  // Domain Data (Read-Only Mirror of Firestore)
  roles: RoleDefinition[];
  rolePermissions: RolePermissions;
  users: User[];
  departments: Department[];
  branches: Branch[];
  suppliers: Supplier[];
  categories: Category[];
  products: Product[];
  
  // ORDER MANAGEMENT (Performance Optimized)
  orders: OrderRecord[]; // The PUBLIC array consumed by UI (Merged result)
  
  // Internal State for Order Merging
  _liveOrders: OrderRecord[];     // Outgoing Orders (I placed these)
  _incomingOrders: OrderRecord[]; // Incoming Orders (Sent to my branch) - NEW
  _archivedOrders: OrderRecord[]; // History fetched on demand
  
  emailConfig: EmailConfig | null;

  // Price Monitoring & Invoices
  priceChangeNotices: PriceChangeNotice[];
  newItemNotices: NewItemNotice[];
  priceHistory: PriceHistoryRecord[];
  priceMonitoringSettings: PriceMonitoringSettings;
  
  // Setters for Sync (Called by onSnapshot in App.tsx)
  setRoles: (roles: RoleDefinition[]) => void;
  setRolePermissions: (perms: RolePermissions) => void;
  setUsers: (users: User[]) => void;
  setDepartments: (departments: Department[]) => void;
  setBranches: (branches: Branch[]) => void;
  setSuppliers: (suppliers: Supplier[]) => void;
  setCategories: (categories: Category[]) => void;
  setProducts: (products: Product[]) => void;
  setPriceChangeNotices: (notices: PriceChangeNotice[]) => void;
  setNewItemNotices: (notices: NewItemNotice[]) => void;
  setPriceHistory: (history: PriceHistoryRecord[]) => void;
  setPriceMonitoringSettings: (settings: PriceMonitoringSettings) => void;
  
  // Smart Order Sync Actions
  syncLiveOrders: (orders: OrderRecord[]) => void; 
  syncIncomingOrders: (orders: OrderRecord[]) => void; // NEW
  appendArchivedOrders: (orders: OrderRecord[]) => void;
  fetchArchivedOrders: (startStr: string, endStr: string, incomingOnly?:boolean) => Promise<void>;
  
  setEmailConfig: (config: EmailConfig | null) => void;

  // Cart State (Local Only - No Sync needed)
  cart: Record<string, CartItem>;
  manualCart: ManualOrderItem[];
  
  // UI State
  toasts: ToastMessage[];
  showToast: (type: ToastMessage['type'], message: string, title?: string, duration?: number) => void;
  removeToast: (id: string) => void;

  // Local Cart Actions
  setCartItem: (productId: string, productName: string, caseQty: number, packQty: number, casePrice?: number, packPrice?: number) => void;
  replaceCart: (items: CartItem[]) => void;
  clearCart: () => void;
  
  // Firebase Write Actions
  addOrder: (order: OrderRecord) => Promise<void>;
  updateOrder: (orderId: string, updates: Partial<OrderRecord>) => Promise<void>;
  deleteOrder: (orderId: string) => Promise<void>;
  markOrderAsProcessed: (orderId: string, updates?: Partial<OrderRecord>) => Promise<void>; 
  
  updateProduct: (product: Product) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  addProduct: (product: Product) => Promise<void>;

  updateUser: (user: User) => Promise<void>;
  deleteUser: (id: string) => Promise<void>;
  addUser: (user: User) => Promise<void>;

  updateDepartment: (department: Department) => Promise<void>;
  deleteDepartment: (id: string) => Promise<void>;
  archiveDepartment: (id: string, archived?: boolean) => Promise<void>;
  addDepartment: (department: Department) => Promise<void>;

  updateBranch: (branch: Branch) => Promise<void>;
  deleteBranch: (id: string) => Promise<void>;
  addBranch: (branch: Branch) => Promise<void>;

  updateSupplier: (supplier: Supplier) => Promise<void>;
  reorderSupplier: (id:string, destinationId:string) => Promise<void>;
  deleteSupplier: (id: string, options?: { reassignProductsToSupplierId?: string; reassignCategoryId?: string; deactivateProducts?: boolean }) => Promise<void>;
  addSupplier: (supplier: Supplier) => Promise<void>;

  updateCategory: (category: Category) => Promise<void>;
  deleteCategory: (id: string, options?: { reassignProductsToCategoryId?: string; deactivateProducts?: boolean }) => Promise<void>;
  addCategory: (category: Category) => Promise<void>;

  updateRolePermissions: (roleId: string, permissions: Permission[]) => Promise<void>;
  addRole: (role: RoleDefinition) => Promise<void>;
  deleteRole: (roleId: string) => Promise<void>;
  updateRole: (role: RoleDefinition) => Promise<void>;

  saveEmailConfig: (config: EmailConfig) => Promise<void>;

  // Price Monitoring & Invoice Actions
  addPriceChangeNotice: (notice: PriceChangeNotice) => Promise<void>;
  updatePriceChangeNotice: (id: string, updates: Partial<PriceChangeNotice>) => Promise<void>;
  approvePriceChange: (noticeId: string, effectiveDate: string, notes?: string) => Promise<void>;
  rejectPriceChange: (noticeId: string, reason: string) => Promise<void>;
  addNewItemNotice: (notice: NewItemNotice) => Promise<void>;
  resolveNewItem: (noticeId: string, resolution: 'ADDED' | 'LINKED', productData?: Partial<Product>, linkedProductId?: string, notes?: string) => Promise<void>;
  rejectNewItem: (noticeId: string, reason: string) => Promise<void>;
  savePriceMonitoringSettings: (settings: PriceMonitoringSettings) => Promise<void>;
  addPriceHistoryRecord: (record: PriceHistoryRecord) => Promise<void>;
}

// Helper to merge arrays unique by ID
const mergeOrders = (live: OrderRecord[], incoming: OrderRecord[], archived: OrderRecord[]): OrderRecord[] => {
  const map = new Map<string, OrderRecord>();
  // Archived first (lowest priority)
  archived.forEach(o => map.set(o.id, o));
  // Incoming next (orders sent TO me)
  incoming.forEach(o => map.set(o.id, o));
  // Live last (orders I placed - highest priority if overlap, though IDs should be unique)
  live.forEach(o => map.set(o.id, o));
  return Array.from(map.values());
};

// Check user permissions for a given operational or administrative action
export const can = (user: User | null, action: Permission): boolean => {
  if (!user || user.active !== true) return false;
  if (action === 'review_invoices') return canReviewInvoices(user, useAppStore.getState().rolePermissions);
  // Creator and GM have full enterprise-wide system and operational access
  if (user.role === 'CREATOR' || user.role === 'GM') return true; 

  // Distinguish Inherited permissions from Custom permissions.
  // Custom with no actions must mean no actions.
  const isCustom = user.permissionMode === 'CUSTOM' || 
    (user.permissionMode !== 'INHERITED' &&
     Array.isArray(user.customPermissions) &&
     user.customPermissions.length > 0);

  if (isCustom) {
    const customList = Array.isArray(user.customPermissions) ? user.customPermissions : [];
    return customList.includes(action);
  }

  const permissions = useAppStore.getState().rolePermissions[user.role] || DEFAULT_ROLE_PERMISSIONS[user.role] || [];
  return permissions.includes(action);
};

/**
 * Omits genuinely optional undefined fields from persistence payloads before writing to Firestore.
 * Preserves explicit 0, empty string, false, and null values without inventing defaults.
 */
export const sanitizePersistencePayload = <T extends Record<string, any>>(obj: T): T => {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
};

export const useAppStore = create<AppState>()(persist((set, get) => ({
  currentUser: null,
  setCurrentUser: (user) => {
    const prev = get().currentUser;
    if (orderScopeKey(prev) !== orderScopeKey(user)) {
      set({ products:[],priceHistory:[],priceChangeNotices:[],newItemNotices:[],orders: [], _liveOrders: [], _incomingOrders: [], _archivedOrders: [] });
    }
    if (user && (!prev || prev.id !== user.id)) {
      if (prev) {
        try {
          localStorage.setItem(`htos_cart_${prev.id}`, JSON.stringify(get().cart));
          localStorage.setItem(`htos_manual_cart_${prev.id}`, JSON.stringify(get().manualCart));
        } catch (_) {}
      }
      let restoredCart = {};
      let restoredManualCart: ManualOrderItem[] = [];
      try {
        const saved = localStorage.getItem(`htos_cart_${user.id}`);
        if (saved) restoredCart = JSON.parse(saved);
        const savedManual = localStorage.getItem(`htos_manual_cart_${user.id}`);
        if (savedManual) restoredManualCart = JSON.parse(savedManual);
      } catch (_) {}
      set({ currentUser: user, cart: restoredCart, manualCart: restoredManualCart });
    } else if (!user) {
      if (prev) {
        try {
          localStorage.setItem(`htos_cart_${prev.id}`, JSON.stringify(get().cart));
          localStorage.setItem(`htos_manual_cart_${prev.id}`, JSON.stringify(get().manualCart));
        } catch (_) {}
      }
      set({
        currentUser: null,
        cart: {},
        manualCart: [],
        orders: [],
        _liveOrders: [],
        _incomingOrders: [],
        _archivedOrders: [],
        users: [],
        departments: SEED_DEPARTMENTS,
        branches: [],
        suppliers: [],
        categories: [],
        products: [],
        roles: [],
        rolePermissions: DEFAULT_ROLE_PERMISSIONS,
        emailConfig: null,
        priceChangeNotices: [],
        newItemNotices: [],
        priceHistory: [],
        priceMonitoringSettings: DEFAULT_PRICE_MONITORING_SETTINGS,
      });
    } else {
      set({ currentUser: user });
    }
  },
  logout: async () => {
    const current = get().currentUser;
    if (current) {
      try {
        localStorage.setItem(`htos_cart_${current.id}`, JSON.stringify(get().cart));
        localStorage.setItem(`htos_manual_cart_${current.id}`, JSON.stringify(get().manualCart));
      } catch (_) {}
    }
    try {
      if (auth) {
        await signOut(auth);
      }
    } catch (err) {
      console.error("Logout failed", err);
    }
    // Clean up session markers and any shared cart storage to isolate from next login
    try {
      localStorage.removeItem('htos_last_active');
      localStorage.removeItem('htos-cart-storage');
      // Broadcast session termination to other open tabs on this browser
      localStorage.setItem('htos_session_event', JSON.stringify({ type: 'logout', timestamp: Date.now() }));
    } catch (_) {}
    set({
      currentUser: null,
      cart: {},
      manualCart: [],
      orders: [],
      _liveOrders: [],
      _incomingOrders: [],
      _archivedOrders: [],
      users: [],
      departments: SEED_DEPARTMENTS,
      branches: [],
      suppliers: [],
      categories: [],
      products: [],
      roles: [],
      rolePermissions: DEFAULT_ROLE_PERMISSIONS,
      emailConfig: null,
      priceChangeNotices: [],
      newItemNotices: [],
      priceHistory: [],
      priceMonitoringSettings: DEFAULT_PRICE_MONITORING_SETTINGS,
    });
  },

  roles: [], 
  rolePermissions: DEFAULT_ROLE_PERMISSIONS,
  users: [],
  departments: SEED_DEPARTMENTS,
  branches: [],
  suppliers: [],
  categories: [],
  products: [],
  
  orders: [],
  _liveOrders: [],
  _incomingOrders: [],
  _archivedOrders: [],
  
  emailConfig: null,
  
  priceChangeNotices: [],
  newItemNotices: [],
  priceHistory: [],
  priceMonitoringSettings: DEFAULT_PRICE_MONITORING_SETTINGS,
  
  cart: {},
  manualCart: [],
  toasts: [],

  // --- UI Actions ---
  showToast: (type, message, title, duration = 3000) => {
    const id = crypto.randomUUID();
    const newToast: ToastMessage = { id, type, message, title, duration };
    set((state) => ({ toasts: [...state.toasts, newToast] }));
    
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },

  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),

  // --- Sync Setters ---
  setRoles: (roles) => set({ roles }),
  setRolePermissions: (rolePermissions) => set(state=>JSON.stringify(state.rolePermissions)===JSON.stringify(rolePermissions)?{rolePermissions}:{rolePermissions,products:[],priceHistory:[],priceChangeNotices:[],newItemNotices:[],_incomingOrders:[],_liveOrders:[],_archivedOrders:[],orders:[]}),
  setUsers: (users) => set({ users }),
  setDepartments: (departments) => set({ departments }),
  setBranches: (branches) => set(state=>{
    branches=savedListOrder(branches);
    const user=state.currentUser;
    const changed=user&&JSON.stringify(incomingOrderSupplierIds(user,state.suppliers,state.branches))!==JSON.stringify(incomingOrderSupplierIds(user,state.suppliers,branches));
    return changed?{branches,_incomingOrders:[],_archivedOrders:[],orders:state._liveOrders}:{branches};
  }),
  setSuppliers: (suppliers) => set(state => {
    suppliers=savedListOrder(suppliers);
    const user = state.currentUser;
    const changed = user && JSON.stringify(incomingOrderSupplierIds(user,state.suppliers,state.branches)) !== JSON.stringify(incomingOrderSupplierIds(user,suppliers,state.branches));
    return changed
      ? { suppliers, _incomingOrders: [], _archivedOrders: [], orders: state._liveOrders }
      : { suppliers };
  }),
  setCategories: (categories) => set({ categories }),
  setProducts: (products) => set({ products }),
  setEmailConfig: (emailConfig) => set({ emailConfig }),
  setPriceChangeNotices: (priceChangeNotices) => set({ priceChangeNotices }),
  setNewItemNotices: (newItemNotices) => set({ newItemNotices }),
  setPriceHistory: (priceHistory) => set({ priceHistory }),
  setPriceMonitoringSettings: (priceMonitoringSettings) => set({ priceMonitoringSettings }),

  // --- Smart Order Sync ---
  
  // Called by App.tsx Snapshot (Realtime Listener - Outgoing)
  syncLiveOrders: (liveOrders) => set((state) => ({
    _liveOrders: liveOrders,
    orders: mergeOrders(liveOrders, state._incomingOrders, state._archivedOrders)
  })),

  // Called by App.tsx Snapshot (Realtime Listener - Incoming)
  syncIncomingOrders: (incomingOrders) => set((state) => ({
    _incomingOrders: incomingOrders,
    orders: mergeOrders(state._liveOrders, incomingOrders, state._archivedOrders)
  })),

  // Called by History/Reports Page (Manual Fetch)
  appendArchivedOrders: (archivedOrders) => set((state) => {
    const merged = [...new Map([...state._archivedOrders, ...archivedOrders].map(order => [order.id, order])).values()];
    return {_archivedOrders: merged, orders: mergeOrders(state._liveOrders, state._incomingOrders, merged)};
  }),

  // API Call to fetch history
  fetchArchivedOrders: async (startStr, endStr, incomingOnly=false) => {
    const store = get();
    const user = store.currentUser;
    if (!user) return;

    const scopeAtStart = orderScopeKey(user,store.rolePermissions);
    const incomingIds=can(user,'view_received_orders')?incomingOrderSupplierIds(user,store.suppliers,store.branches):[];
    const incomingAtStart = JSON.stringify(incomingIds);
    const stillAuthorised = () => {
      const latest = get();
      return scopeAtStart === orderScopeKey(latest.currentUser,latest.rolePermissions) &&
        incomingAtStart === JSON.stringify(latest.currentUser&&can(latest.currentUser,'view_received_orders') ? incomingOrderSupplierIds(latest.currentUser,latest.suppliers,latest.branches) : []);
    };
    const partitions = incomingOnly?incomingIds.map(supplierId=>({supplierId})):historyOrderPartitions(user,store.suppliers,incomingIds);
    try {
        if(!can(user,'view_prices')){
          const pages=await Promise.all(partitions.map(partition=>readProtectedRecords({resource:'orders',...partition,start:startStr,end:endStr,incomingOnly})));
          if(stillAuthorised())get().appendArchivedOrders([...new Map(pages.flat().map(order=>[order.id,order])).values()]);
          return;
        }
        const snapshots = await coalescePending(JSON.stringify(['history',scopeAtStart,incomingAtStart,startStr,endStr,incomingOnly]), () =>
          Promise.all(partitions.map(partition => getDocs(scopedOrderQuery(db, partition,
            where('createdAt', '>=', startStr), where('createdAt', '<=', endStr))))));
        // A revoked or changed session must never receive a late history result.
        if (!stillAuthorised()) return;
        const records = new Map<string, OrderRecord>();
        snapshots.forEach(snap => snap.docs.forEach(d => records.set(d.id, { ...d.data(), id: d.id } as OrderRecord)));
        const fetched = [...records.values()];
        get().appendArchivedOrders(fetched);
        get().showToast('success', `Loaded ${fetched.length} historical records.`);
    } catch (err: any) {
        console.error("Fetch History Error", err);
        store.showToast('error', "Failed to load history: " + err.message);
    }
  },

  // --- Local Cart Logic ---
  setCartItem: (productId, productName, caseQty, packQty, casePrice, packPrice) => set((state) => {
    const newCart = { ...state.cart };
    if (caseQty <= 0 && packQty <= 0) {
      delete newCart[productId];
    } else {
      newCart[productId] = { 
        productId, 
        productNameSnapshot: productName, 
        caseQty, 
        packQty, 
        casePriceSnapshot: casePrice,
        packPriceSnapshot: packPrice
      };
    }
    return { cart: newCart };
  }),

  replaceCart: (items) => {
    const newCart: Record<string, CartItem> = {};
    items.forEach(item => {
      newCart[item.productId] = item;
    });
    set({ cart: newCart });
  },

  clearCart: () => set({ cart: {}, manualCart: [] }),

  // --- Firebase Actions ---
  
  addOrder: async (order) => {
    const token=await auth?.currentUser?.getIdToken();
    if(!token)throw new Error('Please sign in again.');
    const response=await fetch('/api/admin/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'order-save',mode:'create',order})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Order could not be saved.');
    set(state=>({orders:[result.order,...state.orders.filter(o=>o.id!==order.id)]}));
  },

  updateOrder: async (orderId, updates) => {
    const existing=get().orders.find(o=>o.id===orderId);
    if(existing?.status==='DRAFT'){
      const token=await auth?.currentUser?.getIdToken();
      if(!token)throw new Error('Please sign in again.');
      const response=await fetch('/api/admin/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'order-save',mode:'edit',expectedRevision:(existing as any)._entryRevision||0,order:{...existing,...updates}})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Draft could not be saved.');
      set(state=>({orders:state.orders.map(o=>o.id===orderId?result.order:o)}));
    }else await updateDoc(doc(db, 'orders', orderId), updates);
  },

  deleteOrder: async (orderId) => {
    await deleteDoc(doc(db, 'orders', orderId));
  },

  markOrderAsProcessed: async (orderId, updates = {}) => {
    const token=await auth?.currentUser?.getIdToken();
    if(!token)throw new Error('Please sign in again.');
    const order=get().orders.find(o=>o.id===orderId);
    const response=await fetch('/api/admin/workspace',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({action:'fulfillment',orderId,expectedProcessedAt:order?.processedAt||'',updates})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Dispatch could not be saved.');
  },

  // --- GAP INDEXING IMPLEMENTATION ---
  
  addProduct: async (product) => {
    const store = get();
    let displayOrder = product.displayOrder;
    if (!displayOrder) {
        const catProducts = store.products.filter(p => p.categoryId === product.categoryId);
        const maxOrder = catProducts.reduce((max, p) => Math.max(max, p.displayOrder || 0), 0);
        displayOrder = maxOrder + 1000;
    }
    const finalProduct = { ...product, displayOrder };
    await setDoc(doc(db, 'products', finalProduct.id), sanitizePersistencePayload(finalProduct));
  },

  updateProduct: async (product) => {
    const store = get();
    const oldProduct = store.products.find(p => p.id === product.id);
    let finalProduct = { ...product };
    if (oldProduct && oldProduct.categoryId !== product.categoryId) {
        const catProducts = store.products.filter(p => p.categoryId === product.categoryId);
        const maxOrder = catProducts.reduce((max, p) => Math.max(max, p.displayOrder || 0), 0);
        finalProduct.displayOrder = maxOrder + 1000;
    }
    await updateDoc(doc(db, 'products', finalProduct.id), sanitizePersistencePayload(finalProduct));
  },

  deleteProduct: async (id) => {
    await deleteDoc(doc(db, 'products', id));
  },

  addUser: async (user) => {
    let token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Sign in to create a user account.');
    let response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'create',
        data: {
          email: user.username,
          displayName: user.displayName,
          role: user.role,
          branchId: user.branchId || '',
          active: user.active ?? true,
          displayOrder: user.displayOrder || 0,
        },
      }),
    });
    if (response.status === 401 && auth?.currentUser) {
      try {
        token = await auth.currentUser.getIdToken(true);
        response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: 'create',
            data: {
              email: user.username,
              displayName: user.displayName,
              role: user.role,
              branchId: user.branchId || '',
              active: user.active ?? true,
              displayOrder: user.displayOrder || 0,
            },
          }),
        });
      } catch (_) {}
    }
    const resData = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(resData.error || 'Failed to create user account.');
    }
  },

  updateUser: async (user) => {
    let token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Sign in to update user account.');
    let response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'update',
        data: {
          id: user.id,
          displayName: user.displayName,
          role: user.role,
          branchId: user.branchId || '',
          active: user.active ?? true,
          displayOrder: user.displayOrder || 0,
        },
      }),
    });
    if (response.status === 401 && auth?.currentUser) {
      try {
        token = await auth.currentUser.getIdToken(true);
        response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            action: 'update',
            data: {
              id: user.id,
              displayName: user.displayName,
              role: user.role,
              branchId: user.branchId || '',
              active: user.active ?? true,
              displayOrder: user.displayOrder || 0,
            },
          }),
        });
      } catch (_) {}
    }
    const resData = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(resData.error || 'Failed to update user account.');
    }
  },

  deleteUser: async (id) => {
    let token = await auth?.currentUser?.getIdToken();
    if (!token) throw new Error('Sign in to delete user account.');
    let response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'delete', data: { id } }),
    });
    if (response.status === 401 && auth?.currentUser) {
      try {
        token = await auth.currentUser.getIdToken(true);
        response = await fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'delete', data: { id } }),
        });
      } catch (_) {}
    }
    const resData = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(resData.error || 'Failed to delete user account.');
    }
  },

  addDepartment: async (dept) => {
    const store = get();
    let displayOrder = dept.displayOrder;
    if (!displayOrder) {
      const maxOrder = store.departments.reduce((max, d) => Math.max(max, d.displayOrder || 0), 0);
      displayOrder = maxOrder + 1;
    }
    const finalDept: Department = { ...dept, displayOrder, archived: dept.archived ?? false };
    set((state) => {
      const exists = state.departments.some(d => d.id === finalDept.id);
      return {
        departments: exists
          ? state.departments.map(d => d.id === finalDept.id ? finalDept : d)
          : [...state.departments, finalDept]
      };
    });
    if (db) {
      try {
        await setDoc(doc(db, 'departments', finalDept.id), finalDept);
      } catch (err: any) {
        console.warn('Could not persist department to Firestore:', err?.message);
      }
    }
  },

  updateDepartment: async (dept) => {
    set((state) => ({
      departments: state.departments.map(d => d.id === dept.id ? { ...d, ...dept } : d)
    }));
    if (db) {
      try {
        await updateDoc(doc(db, 'departments', dept.id), { ...dept });
      } catch (err: any) {
        console.warn('Could not update department in Firestore:', err?.message);
      }
    }
  },

  archiveDepartment: async (id, archived = true) => {
    set((state) => ({
      departments: state.departments.map(d => d.id === id ? { ...d, archived } : d)
    }));
    if (db) {
      try {
        await updateDoc(doc(db, 'departments', id), { archived });
      } catch (err: any) {
        console.warn('Could not archive department in Firestore:', err?.message);
      }
    }
  },

  deleteDepartment: async (id) => {
    set((state) => ({
      departments: state.departments.filter(d => d.id !== id)
    }));
    if (db) {
      try {
        await deleteDoc(doc(db, 'departments', id));
      } catch (err: any) {
        console.warn('Could not delete department from Firestore:', err?.message);
      }
    }
  },

  addBranch: async (branch) => {
    const store=get();
    if(store.branches.some(b=>b.id!==branch.id&&b.code?.trim().toLowerCase()===branch.code.trim().toLowerCase()))throw new Error('This branch code is already in use.');
    const displayOrder=branch.displayOrder||Math.max(0,...store.branches.map(b=>b.displayOrder||0))+1000;
    const batch=writeBatch(db);batch.set(doc(db,'branches',branch.id),{...branch,displayOrder});
    if(branch.actsAsSupplier){const id='s_int_'+branch.id;batch.set(doc(db,'suppliers',id),{id,name:branch.name,email:branch.contactEmail||branch.email||'',active:branch.active,deliveryRules:{},deliverySchedules:{default:'Internal Transfer'},linkedBranchId:branch.id});}
    await batch.commit();
  },
  updateBranch: async (branch) => {
    const store=get();
    if(store.branches.some(b=>b.id!==branch.id&&b.code?.trim().toLowerCase()===branch.code.trim().toLowerCase()))throw new Error('This branch code is already in use.');
    const batch=writeBatch(db);batch.update(doc(db,'branches',branch.id),{...branch});
    const existing=store.suppliers.find(s=>s.linkedBranchId===branch.id);
    if(branch.actsAsSupplier){
      if(existing)batch.update(doc(db,'suppliers',existing.id),{name:branch.name,active:branch.active});
      else {const id='s_int_'+branch.id;batch.set(doc(db,'suppliers',id),{id,name:branch.name,email:branch.contactEmail||branch.email||'',active:branch.active,deliveryRules:{},deliverySchedules:{default:'Internal Transfer'},linkedBranchId:branch.id});}
    }else if(existing)batch.update(doc(db,'suppliers',existing.id),{active:false});
    await batch.commit();
  },
  deleteBranch: async (id) => {
    const store=get();
    if(store.users.some(u=>u.branchId===id||u.branchIds?.includes(id)))throw new Error('Reassign users from this branch before deleting it, or deactivate it instead.');
    const batch=writeBatch(db);batch.delete(doc(db,'branches',id));
    for(const supplier of store.suppliers.filter(s=>s.linkedBranchId===id))batch.update(doc(db,'suppliers',supplier.id),{active:false,linkedBranchId:'',name:supplier.name+' [ARCHIVED]'});
    await batch.commit();
  },

  addSupplier: async (supplier) => {
    supplier={...supplier,displayOrder:supplier.displayOrder??nextListPosition(get().suppliers)};
    validateSupplierMinimum(supplier);
    await setDoc(doc(db, 'suppliers', supplier.id), supplier);
    set((state) => {
      const exists = state.suppliers.some(s => s.id === supplier.id);
      return {
        suppliers: savedListOrder(exists
          ? state.suppliers.map(s => s.id === supplier.id ? supplier : s)
          : [...state.suppliers, supplier])
      };
    });

  },

  updateSupplier: async (supplier) => {
    validateSupplierMinimum(supplier);
    await updateDoc(doc(db, 'suppliers', supplier.id), { ...supplier });
    set((state) => ({
      suppliers: savedListOrder(state.suppliers.map(s => s.id === supplier.id ? { ...s, ...supplier } : s))
    }));

  },

  reorderSupplier: async (id, destinationId) => {
    if(supplierOrderSaving)throw new Error('Wait for the current supplier order to finish saving.');
    supplierOrderSaving=true;
    try{
    const state=get();
    if(!canArrangeSuppliers(state.currentUser))throw new Error('Only the workspace owner or GM can rearrange suppliers.');
    if(typeof navigator!=='undefined'&&!navigator.onLine)throw new Error('Reconnect before rearranging suppliers.');
    const ordered=savedListOrder(state.suppliers);
    const changes=planListMove(ordered,ordered.findIndex(s=>s.id===id),ordered.findIndex(s=>s.id===destinationId));
    if(!changes.length)return;
    if(changes.length>400)throw new Error('This list needs too many position changes. Contact the workspace owner.');
    const batch=writeBatch(db);
    changes.forEach(change=>batch.update(doc(db,'suppliers',change.id),{displayOrder:change.displayOrder}));
    await batch.commit();
    // Preserve all other fields, including any newer supplier details received during saving.
    if(get().currentUser?.id!==state.currentUser?.id)return;
    set(current=>({suppliers:savedListOrder(current.suppliers.map(s=>{
      const change=changes.find(item=>item.id===s.id);return change?{...s,displayOrder:change.displayOrder}:s;
    }))}));
    }finally{supplierOrderSaving=false;}
  },

  deleteSupplier: async (id, options) => {
    const store=get();
    const changes=supplierRemoval(id,options?.reassignProductsToSupplierId,store.products,store.categories,store.suppliers);
    const batch=writeBatch(db);
    for(const change of changes){const ref=doc(db,change.collection,change.id);if(change.patch)batch.update(ref,change.patch);else batch.delete(ref);}
    await batch.commit();
    set(state=>{
      const next:any={};
      for(const collection of ['products','categories','suppliers'] as const)next[collection]=state[collection].flatMap(record=>{const change=changes.find(c=>c.collection===collection&&c.id===record.id);return !change?[record]:change.patch?[{...record,...change.patch}]:[];});
      return next;
    });
  },

  addCategory: async (category) => {
    const store = get();
    let displayOrder = category.displayOrder;
    if (!displayOrder) {
        const supCats = store.categories.filter(c => c.supplierId === category.supplierId);
        const maxOrder = supCats.reduce((max, c) => Math.max(max, c.displayOrder || 0), 0);
        displayOrder = maxOrder + 1000;
    }
    const finalCat = { ...category, displayOrder };
    await setDoc(doc(db, 'categories', finalCat.id), finalCat);
    set((state) => {
      const exists = state.categories.some(c => c.id === finalCat.id);
      return {
        categories: exists
          ? state.categories.map(c => c.id === finalCat.id ? finalCat : c)
          : [...state.categories, finalCat]
      };
    });

  },

  updateCategory: async (category) => {
    await updateDoc(doc(db, 'categories', category.id), { ...category });
    set((state) => ({
      categories: state.categories.map(c => c.id === category.id ? { ...c, ...category } : c)
    }));

  },

  deleteCategory: async (id, options) => {
    const store=get();
    const changes=categoryRemoval(id,options?.reassignProductsToCategoryId,store.products,store.categories);
    const batch=writeBatch(db);
    for(const change of changes){const ref=doc(db,change.collection,change.id);if(change.patch)batch.update(ref,change.patch);else batch.delete(ref);}
    await batch.commit();
    set(state=>{
      const next:any={};
      for(const collection of ['products','categories','suppliers'] as const)next[collection]=state[collection].flatMap(record=>{const change=changes.find(c=>c.collection===collection&&c.id===record.id);return !change?[record]:change.patch?[{...record,...change.patch}]:[];});
      return next;
    });
  },

  addRole: async (role) => {
    await setDoc(doc(db, 'roles', role.id), role);
  },
  
  updateRole: async (role) => {
    await updateDoc(doc(db, 'roles', role.id), { ...role });
  },

  deleteRole: async (id) => {
    if(get().roles.find(r=>r.id===id)?.isSystem || ['CREATOR','GM','MANAGER','STAFF'].includes(id)) throw new Error('System roles cannot be deleted.');
    if(get().users.some(u=>u.role===id)) throw new Error('Assign users to another role before deleting this role.');
    await deleteDoc(doc(db, 'roles', id));
  },

  updateRolePermissions: async (roleId, permissions) => {
    const store = get();
    const currentUser = store.currentUser;
    if (!currentUser || (currentUser.role !== 'CREATOR' && currentUser.role !== 'GM')) {
      throw new Error('Only Administrators can modify role permissions.');
    }
    const newPerms = { ...store.rolePermissions, [roleId]: permissions };
    await setDoc(doc(db, 'settings', 'role_permissions'), { map: newPerms }, { merge: true });
  },

  saveEmailConfig: async (config) => {
    const store = get();
    const currentUser = store.currentUser;
    if (!currentUser || (currentUser.role !== 'CREATOR' && currentUser.role !== 'GM')) {
      throw new Error('Only Administrators can modify email configuration.');
    }
    // Scrub sensitive credential fields to ensure no plaintext passwords are ever persisted in client-readable settings
    const sanitized = { ...config };
    delete (sanitized as any).smtpPass;
    await setDoc(doc(db, 'settings', 'email_config'), sanitized as any, { merge: true });
    set({ emailConfig: sanitized });
  },

  // Price Monitoring & Invoices Actions
  addPriceChangeNotice: async (notice) => {
    await setDoc(doc(db, 'price_change_notices', notice.id), sanitizePersistencePayload(notice));
  },

  updatePriceChangeNotice: async (id, updates) => {
    await updateDoc(doc(db, 'price_change_notices', id), sanitizePersistencePayload(updates));
  },

  approvePriceChange: async (noticeId, effectiveDate, notes = '') => {
    const store = get();
    const notice = store.priceChangeNotices.find(n => n.id === noticeId);
    if (!notice) throw new Error('Price change notice not found');
    if (notice.status !== 'PENDING') {
      throw new Error(`Notice has already been processed as "${notice.status}" and cannot be reviewed again.`);
    }

    const currentUser = store.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const canApprove = can(currentUser, 'approve_price_changes') || currentUser.role === 'CREATOR' || currentUser.role === 'GM';
    if (!canApprove) {
      throw new Error('You do not have permission to approve price changes.');
    }

    // Self-approval protection for non-admins (case or pack)
    const isSelfPriceIncrease = 
      (notice.newCasePrice !== undefined && notice.oldCasePrice !== undefined && notice.newCasePrice > notice.oldCasePrice) ||
      (notice.newPackPrice !== undefined && notice.oldPackPrice !== undefined && notice.newPackPrice > notice.oldPackPrice);
    if (currentUser.role !== 'CREATOR' && currentUser.role !== 'GM' && notice.uploadedByUserId === currentUser.id && isSelfPriceIncrease) {
      throw new Error('Non-admin users cannot approve their own proposed price increases.');
    }

    const targetProduct = store.products.find(p => p.id === notice.productId);
    if (targetProduct) {
      const finalCase = notice.newCasePrice !== undefined ? notice.newCasePrice : targetProduct.casePrice;
      const finalPack = notice.newPackPrice !== undefined ? notice.newPackPrice : targetProduct.packPrice;
      const updatedProduct: Product = {
        ...targetProduct,
      };
      if (finalCase !== undefined) {
        updatedProduct.casePrice = finalCase;
      } else {
        delete updatedProduct.casePrice;
      }
      if (finalPack !== undefined) {
        updatedProduct.packPrice = finalPack;
      } else {
        delete updatedProduct.packPrice;
      }
      await store.updateProduct(updatedProduct);
    }

    // Write audit trail into price_history
    const historyRecord: any = {
      id: crypto.randomUUID(),
      productId: notice.productId,
      productName: notice.productName,
      itemCode: notice.itemCode,
      supplierId: notice.supplierId,
      supplierName: notice.supplierName,
      effectiveDate: effectiveDate || new Date().toISOString().split('T')[0],
      invoiceRef: notice.invoiceNumber,
      approvedByUserId: currentUser.id,
      approvedByUserName: currentUser.displayName,
      approvedAt: new Date().toISOString(),
      notes: notes || notice.notes || '',
    };
    if (notice.oldCasePrice !== undefined) historyRecord.previousCasePrice = notice.oldCasePrice;
    if (notice.newCasePrice !== undefined) historyRecord.newCasePrice = notice.newCasePrice;
    if (notice.oldPackPrice !== undefined) historyRecord.previousPackPrice = notice.oldPackPrice;
    if (notice.newPackPrice !== undefined) historyRecord.newPackPrice = notice.newPackPrice;
    await setDoc(doc(db, 'price_history', historyRecord.id), sanitizePersistencePayload(historyRecord) as PriceHistoryRecord);

    // Update notice status
    await updateDoc(doc(db, 'price_change_notices', noticeId), sanitizePersistencePayload({
      status: 'APPROVED',
      reviewedByUserId: currentUser.id,
      reviewedByUserName: currentUser.displayName,
      reviewedAt: new Date().toISOString(),
      effectiveDate: effectiveDate || new Date().toISOString().split('T')[0],
      notes: notes || notice.notes || '',
    }));
  },

  rejectPriceChange: async (noticeId, reason) => {
    const store = get();
    const notice = store.priceChangeNotices.find(n => n.id === noticeId);
    if (!notice) throw new Error('Price change notice not found');
    if (notice.status !== 'PENDING') {
      throw new Error(`Notice has already been processed as "${notice.status}" and cannot be reviewed again.`);
    }

    const currentUser = store.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const canReject = can(currentUser, 'reject_price_changes') || currentUser.role === 'CREATOR' || currentUser.role === 'GM';
    if (!canReject) {
      throw new Error('You do not have permission to reject price changes.');
    }

    if (!reason || !reason.trim()) {
      throw new Error('Rejection reason is required.');
    }

    await updateDoc(doc(db, 'price_change_notices', noticeId), {
      status: 'REJECTED',
      rejectionReason: reason.trim(),
      reviewedByUserId: currentUser.id,
      reviewedByUserName: currentUser.displayName,
      reviewedAt: new Date().toISOString(),
    });
  },

  addNewItemNotice: async (notice) => {
    await setDoc(doc(db, 'new_item_notices', notice.id), sanitizePersistencePayload(notice));
  },

  resolveNewItem: async (noticeId, resolution, productData, linkedProductId, notes = '') => {
    const store = get();
    const notice = store.newItemNotices.find(n => n.id === noticeId);
    if (!notice) throw new Error('New item notice not found');
    if (notice.status !== 'PENDING') {
      throw new Error(`New item notice has already been processed as "${notice.status}" and cannot be resolved again.`);
    }

    const currentUser = store.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const canManage = can(currentUser, 'manage_new_items') || currentUser.role === 'CREATOR' || currentUser.role === 'GM';
    if (!canManage) {
      throw new Error('You do not have permission to manage new items.');
    }

    if (resolution === 'ADDED' && productData) {
      await store.addProduct(productData as Product);
      await updateDoc(doc(db, 'new_item_notices', noticeId), {
        status: 'ADDED',
        createdProductId: productData.id,
        reviewedByUserId: currentUser.id,
        reviewedByUserName: currentUser.displayName,
        reviewedAt: new Date().toISOString(),
        notes: notes || '',
      });
    } else if (resolution === 'LINKED' && linkedProductId) {
      if (productData) {
        const existing = store.products.find(p => p.id === linkedProductId);
        if (existing) {
          await store.updateProduct({
            ...existing,
            ...productData,
          });
        }
      }
      await updateDoc(doc(db, 'new_item_notices', noticeId), {
        status: 'LINKED',
        linkedProductId,
        reviewedByUserId: currentUser.id,
        reviewedByUserName: currentUser.displayName,
        reviewedAt: new Date().toISOString(),
        notes: notes || '',
      });
    }
  },

  rejectNewItem: async (noticeId, reason) => {
    const store = get();
    const notice = store.newItemNotices.find(n => n.id === noticeId);
    if (!notice) throw new Error('New item notice not found');
    if (notice.status !== 'PENDING') {
      throw new Error(`New item notice has already been processed as "${notice.status}" and cannot be resolved again.`);
    }

    const currentUser = store.currentUser;
    if (!currentUser) throw new Error('User not authenticated');

    const canManage = can(currentUser, 'manage_new_items') || currentUser.role === 'CREATOR' || currentUser.role === 'GM';
    if (!canManage) {
      throw new Error('You do not have permission to manage new items.');
    }

    if (!reason || !reason.trim()) {
      throw new Error('Rejection reason is required.');
    }

    await updateDoc(doc(db, 'new_item_notices', noticeId), {
      status: 'REJECTED',
      rejectionReason: reason.trim(),
      reviewedByUserId: currentUser.id,
      reviewedByUserName: currentUser.displayName,
      reviewedAt: new Date().toISOString(),
    });
  },

  savePriceMonitoringSettings: async (settings) => {
    const store = get();
    const currentUser = store.currentUser;
    if (!currentUser || (currentUser.role !== 'CREATOR' && currentUser.role !== 'GM')) {
      throw new Error('Only General Managers and Creators can modify global price monitoring settings.');
    }
    await setDoc(doc(db, 'settings', 'price_monitoring'), settings as any, { merge: true });
  },

  addPriceHistoryRecord: async (record) => {
    await setDoc(doc(db, 'price_history', record.id), sanitizePersistencePayload(record));
  }

}), {
  name: 'htos-cart-storage',
  partialize: (state) => (state.currentUser ? { cart: state.cart, manualCart: state.manualCart } : { cart: {}, manualCart: [] })
}));
