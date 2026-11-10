import type {DeliveryCheck,SupplierCase} from './shared/delivery-check';
export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  isSystem: boolean; // If true, cannot be deleted
}

export interface Department {
  id: string; // Permanent ID, e.g. 'dept_front', 'dept_kitchen', 'dept_sushi'
  name: string;
  code: string;
  archived?: boolean;
  displayOrder?: number;
  createdAt?: string;
}

export interface User {
  id: string;
  username: string; // This is the Email
  displayName: string;
  // REMOVED: password & passwordHash for security. 
  // Passwords are now handled exclusively by Firebase Auth via API.
  role: string; // References RoleDefinition.id
  branchId?: string; // Default or preferred branch
  active: boolean;
  displayOrder?: number; // New: For drag and drop sorting

  // Department Access
  allDepartments?: boolean;
  departmentIds?: string[];

  // Location Access
  allBranches?: boolean;
  branchIds?: string[];

  // Supplier Access
  allSuppliers?: boolean; // All eligible department suppliers for branch
  supplierIds?: string[]; // Selected eligible suppliers

  // Granular Action Permissions / Overrides
  permissionMode?: 'INHERITED' | 'CUSTOM';
  customPermissions?: Permission[];
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  active: boolean;
  // New Fields
  address?: string;
  contactPerson?: string;
  contactPhone?: string;
  contactEmail?: string; // Specific contact email for this branch
  email?: string; // Branch email for CC
  actsAsSupplier?: boolean; // V3.4.4: Branch acts as internal supplier
  displayOrder?: number; // New: For drag and drop sorting
}

export interface Supplier {
  displayOrder?: number;
  minimumOrderAmount?: number; // GBP excluding VAT; default for all ordering branches.
  branchMinimumOrderAmounts?: Record<string, number>; // 0 overrides the default with no minimum.
  id: string;
  name: string;
  email: string; // Can be comma separated
  active: boolean;
  deliveryRules: Record<string, number[]>; // branchId -> [0,1,2...] days of week
  deliverySchedules: Record<string, string>; // 'default' | branchId -> text
  // New Fields
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string; // Sales person specific email
  linkedBranchId?: string; // V3.4.4: Links this supplier to an internal branch
  // V3.5.0: WhatsApp Integration
  mobileNumber?: string;
  preferredMethod?: 'EMAIL' | 'WHATSAPP' | 'BOTH';
  
  // V3.8.1: Account Resolution Strategy
  globalAccountCode?: string; // Scenario B: Global Master ID
  branchAccountCodes?: Record<string, string>; // Scenario A: Per-Branch Overrides { branchId: 'ACC123' }

  // Multi-department & Location configuration
  allDepartments?: boolean;
  departmentIds?: string[];
  allBranches?: boolean;
  availableBranchIds?: string[];
}

export interface Category {
  id: string;
  name: string;
  supplierId?: string;
  displayOrder: number;
  active: boolean;
}

export type UnitType = 'DUAL' | 'CASE_ONLY' | 'PACK_ONLY';

export interface Product {
  removedAt?: string; // Removed from catalogue; retained for historical references.
  cataloguePosition?: number; // Supplier-wide sequence shared by CSV, ordering and checklists.
  id: string; // Internal ID
  itemCode?: string; // Vendor specific code
  name: string;
  chineseName?: string;
  categoryId: string;
  supplierId: string;
  displayOrder: number;
  allowedBranchIds: string[]; // Empty = all
  active: boolean;
  packSize?: string;
  // New Fields
  casePrice?: number;
  packPrice?: number;
  vatRate?: number; // e.g. 0 or 0.20
  // Customizable Dual & Single Unit Support
  unitType?: UnitType;
  caseUnitName?: string; // e.g., 'Box', 'Case', 'Tub', 'Crate', 'Carton'
  packUnitName?: string; // e.g., 'Unit', 'Pack', 'Bottle', 'Can', 'Kg', 'Pcs'
  // Par-Level Replenishment Fields
  minParLevel?: number;
  targetParLevel?: number;
}

export function getCaseUnitLabel(product?: Partial<Product>): string {
  return product?.caseUnitName?.trim() || 'Box';
}

export function getPackUnitLabel(product?: Partial<Product>): string {
  return product?.packUnitName?.trim() || 'Unit';
}

export function isCaseQtyAllowed(product?: Partial<Product>): boolean {
  if (!product || !product.unitType) return true;
  return product.unitType === 'DUAL' || product.unitType === 'CASE_ONLY';
}

export function isPackQtyAllowed(product?: Partial<Product>): boolean {
  if (!product || !product.unitType) return true;
  return product.unitType === 'DUAL' || product.unitType === 'PACK_ONLY';
}

export interface OrderItem {
  productId: string;
  productNameSnapshot: string;
  chineseNameSnapshot?: string;
  itemCodeSnapshot?: string;
  caseQty: number;
  packQty: number;
  casePriceSnapshot?: number;
  packPriceSnapshot?: number;
  caseUnitSnapshot?: string;
  packUnitSnapshot?: string;
  vatRate?: number; // e.g. 0 or 0.20
  // V3.5.1: Fulfillment Tracking
  sentCaseQty?: number;
  sentPackQty?: number;
  shortageReason?: string;
}

export interface ManualOrderItem {
  id: string;
  description: string;
  caseQty: number;
  packQty: number;
  casePriceSnapshot?: number; // Estimated or quoted box price
  packPriceSnapshot?: number; // Estimated or quoted pack/unit price
  caseUnitSnapshot?: string;
  packUnitSnapshot?: string;
  pricingStatus?: 'CONFIRMED' | 'ESTIMATED' | 'UNPRICED';
  vatRate?: number; // e.g. 0 or 0.20
  // V3.5.1: Fulfillment Tracking
  sentCaseQty?: number;
  sentPackQty?: number;
  shortageReason?: string;
}

// --- V3.9.0: Invoice Scan & Credit Note Interfaces ---
export interface CreditNoteClaimItem {
  id: string;
  itemCode?: string;
  description: string;
  issueType: 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM';
  orderedQtyStr: string;
  deliveredQtyStr: string;
  expectedPrice: number;
  invoicedPrice: number;
  claimAmount: number;
  notes?: string;
}

export interface CreditNoteClaimRevision {
  revisionId: string;
  cnRef: string;
  claimDate: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  items: CreditNoteClaimItem[];
  totalClaimAmount: number;
  emailStatus?: 'SENT' | 'PENDING' | 'FAILED';
  sentAt?: string;
  notes?: string;
}

export interface CreditNoteClaim {
  evidence?: InvoiceEvidence[];
  requestStatus?: 'DRAFT' | 'APPROVED' | 'SENT' | 'PARTIAL' | 'RESOLVED';
  cnRef: string;
  claimDate: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  items: CreditNoteClaimItem[];
  totalClaimAmount: number;
  supplierEmail: string;
  branchCcEmail: string;
  notes?: string;
  emailStatus?: 'SENT' | 'PENDING' | 'FAILED';
  sentAt?: string;
  version?: number;
  claimHistory?: CreditNoteClaimRevision[];
}

export type InvoiceScanStatus = 'NOT_STARTED' | 'SCANNING' | 'SUCCEEDED' | 'FAILED';
export type InvoiceReviewStatus = 'DRAFT' | 'INCOMPLETE' | 'REVIEWED_WITH_EXCEPTION' | 'VERIFIED';
export type InvoiceReviewMethod = 'OCR' | 'MANUAL' | 'OCR_ASSISTED';

export interface InvoiceEvidence { id:string; lineId:string; fileName:string; dataUrl:string; caption:string; }

export interface ReviewedInvoiceLine {
  inputVersion?: 2;
  enteredLineTotal?: number;
  invoicedCaseQty?: number;
  invoicedPackQty?: number;
  damagedCaseQty?: number;
  damagedPackQty?: number;
  receiptConfirmed?: boolean;
  lineId: string;
  productId?: string;
  itemCode?: string;
  description: string;
  unit?: string;
  orderedCaseQty: number;
  orderedPackQty: number;
  deliveredCaseQty: number;
  deliveredPackQty: number;
  expectedCasePrice?: number;
  expectedPackPrice?: number;
  invoicedCasePrice?: number;
  invoicedPackPrice?: number;
  weightRate?: number;
  netAmount: number;
  vatRate?: number;
  vatAmount?: number;
  grossAmount: number;
  isAmountOverridden?: boolean;
  manualAmountOverride?: number;
  issueType: 'NONE' | 'SHORTAGE' | 'PRICE_OVERCHARGE' | 'DAMAGED' | 'WRONG_ITEM';
  conversionDecision?: string;
  matchingDecision?: string;
  notes?: string;
  isReviewed: boolean;
  isGenuineZeroPrice?: boolean;
}

export interface InvoiceVerificationRevision {
  version: number;
  verifiedAt: string;
  verifiedBy: string;
  totalInvoicedValue: number;
  discrepancyTotal: number;
  reason?: string;
}

export interface InvoiceVerification {
  evidence?: InvoiceEvidence[];
  version?: number;
  revisionHistory?: InvoiceVerificationRevision[];
  verifiedAt: string;
  verifiedBy?: string;
  invoiceNumber?: string;
  invoiceNumberNotProvided?: boolean;
  invoiceDate?: string;
  supplierId?: string;
  supplierName?: string;
  branchId?: string;
  branchName?: string;
  hasDiscrepancies: boolean;
  totalOrderedValue: number;
  totalInvoicedValue: number;
  netTotal?: number;
  vatTotal?: number;
  grossTotal?: number;
  discrepancyTotal: number;
  notes?: string;
  reviewStatus?: InvoiceReviewStatus;
  reviewMethod?: InvoiceReviewMethod;
  scanStatus?: InvoiceScanStatus;
  priceComparisonAvailable?: boolean;
  evidenceReference?: string;
  matchedLinesCount?: number;
  unresolvedLinesCount?: number;
  lines?: ReviewedInvoiceLine[];
  isLegacyIncomplete?: boolean;
}

export interface OrderRecord {
  minimumOrderCheck?: import('./shared/order-minimum').OrderMinimumCheck;
  id: string;
  branchId: string;
  branchNameSnapshot: string;
  supplierId: string;
  supplierNameSnapshot: string;
  orderedByUserId: string;
  orderedByNameSnapshot: string;
  // Department Support
  departmentId?: string;
  departmentNameSnapshot?: string;
  createdAt: string; // ISO
  deliveryDate?: string; // YYYY-MM-DD
  items: OrderItem[];
  manualItems: ManualOrderItem[];
  comments?: string;
  emailTo: string;
  status: 'DRAFT' | 'PLACED' | 'CANCELLED';
  archived?: boolean;
  archivedAt?: string;
  archivedByUserId?: string;
  // New Field for V3
  emailStatus?: 'PENDING' | 'SENT' | 'FAILED' | 'OFFLINE_MANUAL' | 'UNCERTAIN' | 'PARTIAL' | 'SKIPPED'; 
  whatsAppStatus?: 'NOT_REQUESTED' | 'OPENED' | 'NOT_SENT';
  emailSentAt?: string;
  emailError?: string;
  emailRetryCount?: number;
  // Runtime Only - Not saved to DB, but populated by Snapshot
  _hasPendingWrites?: boolean;
  // V3.4.4: Internal Supplier Workflow
  receivedStatus?: 'NEW' | 'PROCESSED'; 
  // V3.5.1: Fulfillment Details
  fulfillmentStatus?: 'UNFULFILLED' | 'PARTIAL' | 'FULFILLED';
  processedAt?: string;
  processedByUserId?: string;
  processedByNameSnapshot?: string;
  fulfillmentNotes?: string;
  deliveryEmailStatus?: 'PENDING' | 'SENT' | 'FAILED';
  deliveryEmailSentAt?: string;
  deliveryEmailError?: string;
  deliveryEmailRetryCount?: number;
  // V3.9.0: Invoice Scan & Credit Note Workflow
  invoiceNumber?: string;
  invoiceDate?: string;
  scannedInvoiceUrl?: string;
  invoiceVerification?: InvoiceVerification;
  deliveryCheck?: DeliveryCheck;
  supplierCase?: SupplierCase;
  creditNoteClaim?: CreditNoteClaim;
}

export interface CartItem extends OrderItem {}

// --- Email Configuration (Display & UI Preferences only; Secrets are server-managed) ---
export interface EmailConfig {
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string; // Legacy/omitted: passwords must never be stored in client-readable documents
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  enabled: boolean;
  useSSL?: boolean;
}

// --- Toast Notifications ---
export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  duration?: number;
}

// --- V3.11.0: Invoice / Delivery Note Price Monitoring & Audit ---
export interface PriceChangeNotice {
  activatedAt?: string;
  id: string;
  productId: string;
  productName: string;
  itemCode?: string;
  supplierId: string;
  supplierName: string;
  oldCasePrice?: number;
  newCasePrice?: number;
  oldPackPrice?: number;
  newPackPrice?: number;
  priceDiff?: number; // Positive = increase, Negative = decrease
  percentChange?: number;
  unitType?: UnitType;
  invoiceNumber: string;
  invoiceDate: string;
  detectedDate: string; // ISO
  scannedFileName?: string;
  scannedFileUrl?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  uploadedByUserId: string;
  uploadedByUserName: string;
  reviewedByUserId?: string;
  reviewedByUserName?: string;
  reviewedAt?: string;
  approvedByUserId?: string;
  approvedByUserName?: string;
  approvedAt?: string;
  effectiveDate?: string;
  rejectionReason?: string;
  notes?: string;
}

export interface NewItemNotice {
  id: string;
  supplierId: string;
  supplierName: string;
  rawDescription: string;
  rawItemCode?: string;
  rawPackSize?: string;
  detectedCasePrice: number;
  detectedPackPrice: number;
  vat?: number;
  invoiceNumber: string;
  invoiceDate: string;
  detectedDate: string; // ISO
  scannedFileName?: string;
  scannedFileUrl?: string;
  status: 'PENDING' | 'ADDED' | 'LINKED' | 'REJECTED';
  uploadedByUserId: string;
  uploadedByUserName: string;
  // Duplicate Detection
  possibleDuplicateProductId?: string;
  possibleDuplicateProductName?: string;
  duplicateMatchScore?: number; // 0 - 100 percentage
  // Resolution Info
  createdProductId?: string;
  linkedProductId?: string;
  reviewedByUserId?: string;
  reviewedByUserName?: string;
  reviewedAt?: string;
  rejectionReason?: string;
  notes?: string;
}

export interface PriceHistoryRecord {
  id: string;
  productId: string;
  productName: string;
  itemCode?: string;
  supplierId: string;
  supplierName: string;
  previousCasePrice?: number;
  newCasePrice?: number;
  previousPackPrice?: number;
  newPackPrice?: number;
  oldCasePrice?: number;
  oldPackPrice?: number;
  priceDiff?: number;
  percentChange?: number;
  effectiveDate: string;
  detectedDate?: string;
  invoiceRef?: string;
  status?: string;
  approvedByUserId: string;
  approvedByUserName: string;
  approvedAt?: string; // ISO
  reason?: string;
  source?: string;
  changeType?: string;
  notes?: string;
}

export interface PriceMonitoringSettings {
  enabled: boolean;
  autoDetectPriceChanges: boolean;
  autoDetectNewItems: boolean;
  requireManagerApproval: boolean;
  alertOnPercentageThreshold: number; // e.g. 5 for 5%
  enableEmailAlerts: boolean;
}

// --- Permission Types ---

export type Permission = 
  | 'view_menu_recipes'
  | 'edit_menu_recipes'
  | 'approve_menu_recipes'
  | 'manage_product_specs'
  | 'place_orders'
  | 'view_reports'
  | 'view_global_data' // NEW: Can see all branches/global context
  | 'view_received_orders'
  | 'manage_users'
  | 'manage_roles'
  | 'manage_products'    // REPLACES manage_catalog
  | 'manage_categories'  // REPLACES manage_catalog
  | 'manage_ordering' // Drag and Drop Reordering
  | 'manage_branches'
  | 'manage_suppliers'
  | 'manage_email_config' // REPLACES manage_import_export
  | 'manage_data'         // REPLACES manage_import_export
  | 'delete_orders'
  | 'delete_drafts'
  | 'admin_access' // Visible sidebar link
  // Granular Action Permissions (Multi-Branch & Department Access)
  | 'create_orders'
  | 'edit_drafts'
  | 'submit_orders'
  | 'view_order_history'
  | 'view_prices'
  | 'view_other_users_orders'
  | 'amend_orders'
  | 'approve_orders'
  | 'cancel_orders'
  | 'manage_departments'
  // V3.11.0: Invoice & Price Monitoring Permissions
  | 'scan_invoices'
  | 'view_price_changes'
  | 'approve_price_changes'
  | 'reject_price_changes'
  | 'manage_new_items'
  | 'view_price_history'
  | 'manage_price_monitoring'
  | 'view_audit_logs';

export interface PermissionDefinition {
  id: Permission;
  label: string;
  description: string;
  group: 'Operations' | 'Administration' | 'System' | 'Menu & Recipes';
}

export type RolePermissions = Record<string, Permission[]>;

// --- V3.12.0: Transactional Outbox & Email Queue ---
export interface EmailOutboxItem {
  id: string;
  orderId?: string;
  orderVersion?: number;
  purposeKey?: string;
  type: 'ORDER_CONFIRMATION' | 'CREDIT_CLAIM' | 'PRICE_ALERT' | 'DELIVERY_NOTE';
  recipientEmail: string;
  ccEmails?: string[];
  actualSender?: string;
  messageId?: string;
  acceptedRecipients?: string[];
  rejectedRecipients?: string[];
  subject: string;
  html?: string;
  pdfBase64?: string;
  pdfFileName?: string;
  status: 'QUEUED' | 'PENDING' | 'SENDING' | 'ACCEPTED' | 'PARTIAL' | 'SENT' | 'FAILED' | 'UNCERTAIN' | 'RETRY_SCHEDULED';
  retryCount: number;
  maxRetries: number;
  nextAttemptAt: string; // ISO
  createdAt: string; // ISO
  processedAt?: string;
  error?: string;
  idempotencyKey: string;
  lockedBy?: string;
  lockedUntil?: string;
}

// --- V3.12.0: Tamper-Proof Audit Logging ---
export interface AuditLogEntry {
  id: string;
  timestamp: string; // ISO
  userId: string;
  userEmail: string;
  userName: string;
  action: string;
  entityType: 'ORDER' | 'USER' | 'PRICE' | 'BRANCH' | 'SUPPLIER' | 'CREDIT_CLAIM' | 'SYSTEM';
  entityId: string;
  branchId?: string;
  details: Record<string, any>;
  ipAddress?: string;
}
