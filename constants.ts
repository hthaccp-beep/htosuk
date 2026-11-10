import type { RoleDefinition, User, Branch, Supplier, Category, Product, PermissionDefinition, RolePermissions, Department } from './types.ts';

export const APP_VERSION = "5.0";
export const APP_BUILD_ID = "2026.10.03-v5.0";
export const APP_TITLE = "HTOS";
export const APP_SUBTITLE = "";
export const APP_TITLE_FULL = `${APP_TITLE} (Version ${APP_VERSION})`;

export function formatRoleName(roleId: string | undefined, roles?: RoleDefinition[]): string {
  if (!roleId) return 'Unknown Role';
  const found = roles?.find(r => r.id === roleId);
  if (found) return found.name;
  switch (roleId.toUpperCase()) {
    case 'CREATOR':
      return 'Creator';
    case 'GM':
      return 'General Manager';
    case 'MANAGER':
      return 'Branch Manager';
    case 'STAFF':
      return 'Staff';
    default:
      return roleId;
  }
}

// Performance: Sync only orders from the last X days automatically
export const LIVE_SYNC_DAYS = 45;

export const SEED_ROLES: RoleDefinition[] = [
  { id: 'CREATOR', name: 'Admin', description: 'System Administrator', isSystem: true },
  { id: 'GM', name: 'General Manager', description: 'Full System Access', isSystem: true },
  { id: 'MANAGER', name: 'Branch Manager', description: 'Manage assigned branch only', isSystem: false },
  { id: 'STAFF', name: 'Staff', description: 'Basic Ordering Access', isSystem: false },
];

export const SEED_DEPARTMENTS: Department[] = [
  { id: 'dept_front', name: 'Front', code: 'FRONT', archived: false, displayOrder: 1 },
  { id: 'dept_kitchen', name: 'Kitchen', code: 'KITCHEN', archived: false, displayOrder: 2 },
  { id: 'dept_sushi', name: 'Sushi', code: 'SUSHI', archived: false, displayOrder: 3 },
];

export const SEED_BRANCHES: Branch[] = []; // Business records are stored privately, not in source control.

export const SEED_USERS: User[] = []; // Business records are stored privately, not in source control.

export const SEED_SUPPLIERS: Supplier[] = []; // Business records are stored privately, not in source control.

export const SEED_CATEGORIES: Category[] = []; // Business records are stored privately, not in source control.

export const SEED_PRODUCTS: Product[] = []; // Business records are stored privately, not in source control.

export const AVAILABLE_PERMISSIONS: PermissionDefinition[] = [
  {id:'view_menu_recipes',label:'View Menu & Recipes',description:'Open standard recipes, cards and supplier specifications',group:'Menu & Recipes'},
  {id:'edit_menu_recipes',label:'Edit standard recipes',description:'Create recipe drafts and choose supplier products and alternatives',group:'Menu & Recipes'},
  {id:'approve_menu_recipes',label:'Approve standard recipes',description:'Approve recipe content separately from allergen review',group:'Menu & Recipes'},
  {id:'manage_product_specs',label:'Upload product specifications',description:'Attach original specification files to exact supplier products',group:'Menu & Recipes'},
  { id: 'place_orders', label: 'Place Order', description: 'Access to Place Order page', group: 'Operations' },
  { id: 'delete_orders', label: 'Delete Orders', description: 'Can delete records from history', group: 'Operations' },
  { id: 'delete_drafts', label: 'Delete Drafts', description: 'Can delete incomplete draft orders', group: 'Operations' },
  { id: 'view_reports', label: 'View Reports', description: 'Access to analytics', group: 'Operations' },
  
  { id: 'view_global_data', label: 'View Global Data', description: 'Access data from ALL branches', group: 'System' },
  { id: 'view_received_orders', label: 'View Received Orders', description: 'View orders sent to this branch (Internal Supplier)', group: 'Operations' },

  { id: 'manage_users', label: 'Manage Users', description: 'Create and edit users', group: 'Administration' },
  { id: 'manage_roles', label: 'Manage Roles', description: 'Create and edit roles', group: 'Administration' },
  
  // GRANULAR PERMISSIONS
  { id: 'manage_products', label: 'Manage Products', description: 'Create and edit Products', group: 'Administration' },
  { id: 'manage_categories', label: 'Manage Categories', description: 'Create and edit Categories', group: 'Administration' },
  
  { id: 'manage_ordering', label: 'Manage Reordering', description: 'Drag & Drop sorting for Items/Categories', group: 'Administration' },
  
  { id: 'manage_branches', label: 'Manage Branches', description: 'Create and edit Branches', group: 'Administration' },
  { id: 'manage_suppliers', label: 'Manage Suppliers', description: 'Create and edit Suppliers', group: 'Administration' },
  
  { id: 'manage_email_config', label: 'Manage Email', description: 'Configure SMTP Settings', group: 'System' },
  { id: 'manage_data', label: 'Manage Data', description: 'Backup, Restore, and Seed DB', group: 'System' },
  
  { id: 'admin_access', label: 'Admin Access', description: 'Access to the Admin Dashboard link', group: 'System' },

  // Granular Action Permissions (Multi-Branch & Department Access)
  { id: 'create_orders', label: 'Create Order', description: 'Initiate draft orders and select items', group: 'Operations' },
  { id: 'edit_drafts', label: 'Edit Draft', description: 'Modify and update saved drafts', group: 'Operations' },
  { id: 'submit_orders', label: 'Submit Order', description: 'Submit and dispatch finalized orders', group: 'Operations' },
  { id: 'view_order_history', label: 'View Order History', description: 'View historical order records within authorized scope', group: 'Operations' },
  { id: 'view_prices', label: 'View Prices', description: 'View product prices and calculated cost totals', group: 'Operations' },
  { id: 'view_other_users_orders', label: "View Other Users' Orders", description: 'View orders placed by colleagues in authorized branches & departments', group: 'Operations' },
  { id: 'amend_orders', label: 'Amend Orders', description: 'Amend orders after initial placement', group: 'Operations' },
  { id: 'approve_orders', label: 'Approve Orders', description: 'Approve orders requiring managerial authorization', group: 'Operations' },
  { id: 'cancel_orders', label: 'Cancel Orders', description: 'Cancel placed orders before fulfillment', group: 'Operations' },
  { id: 'manage_departments', label: 'Manage Departments', description: 'Add, rename, reorder, and archive departments', group: 'Administration' },

  // V3.11.0: Invoice & Price Monitoring Permissions
  { id: 'scan_invoices', label: 'Scan Invoices', description: 'Take photos or upload invoices & delivery notes', group: 'Operations' },
  { id: 'view_price_changes', label: 'View Price Changes', description: 'View detected price discrepancies and review queues', group: 'Operations' },
  { id: 'approve_price_changes', label: 'Approve Price Changes', description: 'Approve new prices and update official catalog prices', group: 'Administration' },
  { id: 'reject_price_changes', label: 'Reject Price Changes', description: 'Reject proposed price changes with reasons', group: 'Administration' },
  { id: 'manage_new_items', label: 'Manage New Items', description: 'Add or link unrecognised invoice products to catalog', group: 'Administration' },
  { id: 'view_price_history', label: 'View Price History', description: 'View audit logs and historical product price revisions', group: 'Operations' },
  { id: 'manage_price_monitoring', label: 'Manage Price Monitoring', description: 'Configure invoice scanning & price detection settings', group: 'System' },
  { id: 'view_audit_logs', label: 'View System Audit Logs', description: 'View immutable system activity, price decisions, and administrative audit logs', group: 'System' },
];

export const DEFAULT_PRICE_MONITORING_SETTINGS = {
  enabled: true,
  autoDetectPriceChanges: true,
  autoDetectNewItems: true,
  requireManagerApproval: true,
  alertOnPercentageThreshold: 5,
  enableEmailAlerts: false,
};

export const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  'CREATOR': [], // Implicit full access
  'GM': [
    'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_other_users_orders', 'amend_orders', 'approve_orders', 'cancel_orders',
    'view_reports', 'view_global_data', 'view_received_orders',
    'manage_users', 'manage_roles', 'manage_departments',
    'manage_products', 'manage_categories', 'manage_ordering', 
    'manage_branches', 'manage_suppliers', 
    'manage_email_config', 'manage_data', 
    'delete_orders', 'delete_drafts', 'admin_access',
    'scan_invoices', 'view_price_changes', 'approve_price_changes', 'reject_price_changes',
    'manage_new_items', 'view_price_history', 'manage_price_monitoring', 'view_audit_logs'
  ],
  'MANAGER': [
    'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices', 'view_other_users_orders', 'amend_orders', 'approve_orders', 'cancel_orders',
    'view_reports', 'view_received_orders', 
    'manage_users', // Local users only (enforced by code)
    'delete_orders', 'delete_drafts', 
    'admin_access',
    'scan_invoices', 'view_price_changes', 'approve_price_changes', 'reject_price_changes',
    'manage_new_items', 'view_price_history'
  ],
  'STAFF': [
    'place_orders', 'create_orders', 'edit_drafts', 'submit_orders', 'view_order_history', 'view_prices',
    'view_received_orders', 'delete_drafts',
    'scan_invoices'
  ]
};
