
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useAppStore, can } from '../../store';
import { useNavigate, useLocation } from 'react-router-dom';
import { CartItem, Product } from '../../types';
import { calculateOrderTotals } from '../../utils/orderPricing';

// Hooks
import { useOrderForm } from './hooks/useOrderForm';
import { useProductFilters } from './hooks/useProductFilters';
import { useOrderSubmission } from './hooks/useOrderSubmission';
import { usePrintChecklist } from './hooks/usePrintChecklist';

// Components
import { OrderHeader } from './components/OrderHeader';
import { ProductGrid } from './components/ProductGrid';
import { CustomItems } from './components/CustomItems';
import { CartButton } from './components/CartButton';
import { ReviewModal } from './components/ReviewModal';
import { Modal } from '../../components/Modal';
import { Save, Trash2, X, AlertTriangle } from 'lucide-react';

// Constants
import { ORDER_CONSTANTS } from './PlaceOrder.constants';

// Local Hook for Online Status (kept simple here)
const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  useEffect(() => {
    const handleStatusChange = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', handleStatusChange);
    window.addEventListener('offline', handleStatusChange);
    return () => {
      window.removeEventListener('online', handleStatusChange);
      window.removeEventListener('offline', handleStatusChange);
    };
  }, []);
  return isOnline;
};

interface PendingContextChange {
  type: 'BRANCH' | 'SUPPLIER';
  targetId: string;
}

export const PlaceOrder: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isOnline = useOnlineStatus();
  const isOffline = !isOnline;

  // Store
  const { 
    currentUser,
    products, 
    cart, 
    setCartItem, 
    clearCart, 
    suppliers,
    branches,
    showToast,
  } = useAppStore();

  // Custom hooks
  const orderForm = useOrderForm();
  const productFilters = useProductFilters({
    selectedSupplierId: orderForm.formState.selectedSupplierId,
    selectedBranchId: orderForm.formState.selectedBranchId,
  });

  // Local state for View logic
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);
  const [pendingContextChange, setPendingContextChange] = useState<PendingContextChange | null>(null);

  // Print checklist hook
  const { isGenerating: isGeneratingChecklist, handlePrint: handlePrintChecklist } = usePrintChecklist({
    sortedCategories: productFilters.sortedCategories,
    groupedProducts: productFilters.allGroupedProducts,
    activeSupplierName: orderForm.activeSupplier?.name || '',
  });

  // Cart calculations
  const cartItems = useMemo(() => Object.values(cart) as CartItem[], [cart]);
  const cartTotalItems = Object.keys(cart).length;
  const manualTotalItems = orderForm.formState.manualItems.filter(
    m => m.description && (m.caseQty > 0 || m.packQty > 0)
  ).length;
  const totalItems = cartTotalItems + manualTotalItems;

  const orderTotals = useMemo(() => {
    return calculateOrderTotals(cartItems, orderForm.formState.manualItems, products);
  }, [cartItems, orderForm.formState.manualItems, products]);
  const estimatedTotal = orderTotals.grandTotal;

  // Order submission hook
  const {
    isSending,
    copySuccess,
    submitConfig,
    handleSaveDraft,
    handleCopyClipboard,
    handleSubmit,
  } = useOrderSubmission({
    formState: orderForm.formState,
    activeBranch: orderForm.activeBranch,
    activeSupplier: orderForm.activeSupplier,
    sendMethod: orderForm.sendMethod,
    resumingDraftId: orderForm.resumingDraftId,
    isOffline,
    products,
    onSuccess: () => {
      clearCart();
      orderForm.resetForm();
      setIsReviewOpen(false);
    },
  });

  // Expand header if resuming draft
  useEffect(() => {
    if (location.state && (location.state as any).isDraftResume) {
        setIsHeaderExpanded(true);
    }
  }, [location]);

  // Handlers
  const handleQuantityChange = useCallback((
    product: Product,
    type: 'case' | 'pack',
    valueStr: string
  ) => {
    const sanitized = valueStr.replace(/[^0-9]/g, '');
    let val = sanitized === '' ? 0 : parseInt(sanitized, 10);
    
    if (val > ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM) {
      val = ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM;
      showToast('warning', `Max limit is ${ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM}.`, 'High Quantity');
    }

    const current = cart[product.id] || { caseQty: 0, packQty: 0 };
    const newCase = type === 'case' ? val : current.caseQty;
    const newPack = type === 'pack' ? val : current.packQty;
    
    setCartItem(
      product.id,
      product.name,
      newCase,
      newPack,
      product.casePrice || 0,
      product.packPrice || 0
    );
  }, [cart, setCartItem, showToast]);

  const executeContextChange = useCallback((change: PendingContextChange) => {
    if (change.type === 'BRANCH') {
      orderForm.setBranchId(change.targetId);
    } else if (change.type === 'SUPPLIER') {
      orderForm.setSupplierId(change.targetId);
      orderForm.setEmailOverride(suppliers.find(s => s.id === change.targetId)?.email || '');
    }
  }, [orderForm, suppliers]);

  const handleAttemptBranchChange = useCallback((newBranchId: string) => {
    if (newBranchId === orderForm.formState.selectedBranchId) return;
    if (totalItems === 0) {
      orderForm.setBranchId(newBranchId);
      return;
    }
    setPendingContextChange({ type: 'BRANCH', targetId: newBranchId });
  }, [totalItems, orderForm]);

  const handleAttemptSupplierChange = useCallback((newSupplierId: string) => {
    if (newSupplierId === orderForm.formState.selectedSupplierId) return;
    if (totalItems === 0) {
      orderForm.setSupplierId(newSupplierId);
      orderForm.setEmailOverride(suppliers.find(s => s.id === newSupplierId)?.email || '');
      return;
    }
    setPendingContextChange({ type: 'SUPPLIER', targetId: newSupplierId });
  }, [totalItems, orderForm, suppliers]);

  const handleSaveAndSwitch = useCallback(async () => {
    if (!pendingContextChange) return;
    const target = pendingContextChange;
    try {
      await handleSaveDraft();
      clearCart();
      executeContextChange(target);
      setPendingContextChange(null);
    } catch (e: any) {
      showToast('error', `Could not save draft: ${e?.message || 'Error'}`);
    }
  }, [pendingContextChange, handleSaveDraft, clearCart, executeContextChange, showToast]);

  const handleDiscardAndSwitch = useCallback(() => {
    if (!pendingContextChange) return;
    const target = pendingContextChange;
    clearCart();
    orderForm.resetForm();
    executeContextChange(target);
    setPendingContextChange(null);
    showToast('info', 'Cart cleared for new context.');
  }, [pendingContextChange, clearCart, orderForm, executeContextChange, showToast]);

  const handleReviewClick = useCallback(() => {
    if (!can(currentUser, 'create_orders')) {
      showToast('error', 'You do not have permission to create or review orders.', 'Permission Denied');
      return;
    }

    if (!orderForm.formState.selectedBranchId) {
      showToast('error', 'Please select a Branch.', 'Missing Branch');
      setIsHeaderExpanded(true);
      return;
    }
    if (!orderForm.formState.selectedSupplierId) {
      showToast('error', 'Please select an eligible Supplier.', 'Missing Supplier');
      setIsHeaderExpanded(true);
      return;
    }
    if (!orderForm.formState.deliveryDate) {
      showToast('error', 'Delivery Date is required.', 'Missing Date');
      setIsHeaderExpanded(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    
    // Incomplete custom items validation
    const hasManualWithMissingQty = orderForm.formState.manualItems.some(
      m => m.description.trim() !== '' && (m.caseQty || 0) <= 0 && (m.packQty || 0) <= 0
    );
    if (hasManualWithMissingQty) {
      showToast('error', 'Please enter a quantity for all custom items, or remove empty rows.', 'Missing Quantity');
      return;
    }

    const hasManualWithMissingDesc = orderForm.formState.manualItems.some(
      m => m.description.trim() === '' && ((m.caseQty || 0) > 0 || (m.packQty || 0) > 0)
    );
    if (hasManualWithMissingDesc) {
      showToast('error', 'Please enter a product description for all custom items with quantities.', 'Missing Description');
      return;
    }

    const hasItems = cartItems.length > 0 || manualTotalItems > 0;
    if (!hasItems) {
      showToast('error', 'Your order is empty. Please select at least one item before continuing.', 'Empty Order');
      return;
    }

    setIsReviewOpen(true);
  }, [currentUser, orderForm.formState, cartItems.length, manualTotalItems, showToast]);

  return (
    <div className="pb-32 max-w-7xl mx-auto">
      <style>{`
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }
        input[type=number] {
          -moz-appearance: textfield;
        }
      `}</style>

      {/* Header */}
      <OrderHeader
        isOnline={isOnline}
        dateHelpers={orderForm.dateHelpers}
        deliveryScheduleText={orderForm.deliveryScheduleText}
        cutoffStatus={orderForm.cutoffStatus}
        deliveryDateValidation={orderForm.deliveryDateValidation}
        canViewGlobal={orderForm.canViewGlobal}
        isHeaderExpanded={isHeaderExpanded}
        onToggleHeader={() => setIsHeaderExpanded(!isHeaderExpanded)}
        onBranchChange={handleAttemptBranchChange}
        onSupplierChange={handleAttemptSupplierChange}
        onDeliveryDateChange={orderForm.setDeliveryDate}
        searchTerm={productFilters.searchTerm}
        onSearchChange={productFilters.setSearchTerm}
        viewMode={productFilters.viewMode}
        onViewModeChange={productFilters.setViewMode}
        isGeneratingChecklist={isGeneratingChecklist}
        onPrintChecklist={handlePrintChecklist}
        hasActiveOrder={totalItems > 0}
        resumingDraftId={orderForm.resumingDraftId}
        needsBranchConfirmation={orderForm.needsBranchConfirmation}
        selectedBranchId={orderForm.formState.selectedBranchId}
        selectedSupplierId={orderForm.formState.selectedSupplierId}
        deliveryDate={orderForm.formState.deliveryDate}
        branches={orderForm.authorizedBranches}
        suppliers={orderForm.eligibleSuppliers}
        categories={productFilters.sortedCategories}
      />

      {/* Empty State when no suppliers qualify */}
      {orderForm.eligibleSuppliers.length === 0 && (
        <div className="m-4 p-8 bg-amber-50/80 border border-amber-200 rounded-2xl text-center space-y-3">
          <AlertTriangle className="mx-auto text-amber-600" size={32} />
          <h3 className="text-base font-bold text-amber-900">No Eligible Suppliers for This Selection</h3>
          <p className="text-xs text-amber-800 max-w-md mx-auto leading-relaxed">
            There are currently no authorized suppliers serving the selected branch ({orderForm.activeBranch?.name}).
            Contact an administrator if you require supplier access for this location.
          </p>
        </div>
      )}

      {/* Product Grid */}
      <ProductGrid
        sortedCategories={productFilters.sortedCategories}
        groupedProducts={productFilters.groupedProducts}
        checklistIndexMap={productFilters.checklistIndexMap}
        cart={cart}
        viewMode={productFilters.viewMode}
        onQuantityChange={handleQuantityChange}
      />

      {/* Custom Items */}
      <CustomItems
        items={orderForm.formState.manualItems}
        maxItems={ORDER_CONSTANTS.MAX_MANUAL_ITEMS}
        onAdd={orderForm.addManualItem}
        onChange={orderForm.updateManualItem}
        onRemove={orderForm.removeManualItem}
      />

      {/* Floating Cart Button */}
      <CartButton 
        totalItems={totalItems} 
        totalAmount={orderTotals.grandTotal} 
        onClick={handleReviewClick} 
      />

      {/* Protected Save-and-Switch Modal Requirement 8 */}
      <Modal
        isOpen={!!pendingContextChange}
        onClose={() => setPendingContextChange(null)}
        className="max-w-md p-6"
      >
        {pendingContextChange && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-amber-600">
              <AlertTriangle size={24} className="shrink-0" />
              <h3 className="text-lg font-bold text-gray-900">Save Basket Before Switching?</h3>
            </div>
            <p className="text-sm text-gray-600 leading-relaxed">
              You have <strong className="text-gray-900">{totalItems} item(s)</strong> in your basket for{' '}
              <strong className="text-brand-600">
                {orderForm.activeBranch?.name} · {orderForm.activeSupplier?.name}
              </strong>.
            </p>
            <p className="text-xs text-gray-500">
              To protect order integrity, the system never silently moves or relabels basket contents across different branches or suppliers.
            </p>
            <div className="flex flex-col gap-2 pt-2">
              <button
                type="button"
                onClick={handleSaveAndSwitch}
                className="w-full bg-brand-600 hover:bg-brand-700 text-white font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 shadow-sm transition-colors"
              >
                <Save size={16} /> Save Draft & Switch
              </button>
              <button
                type="button"
                onClick={handleDiscardAndSwitch}
                className="w-full bg-red-50 hover:bg-red-100 text-red-700 font-bold py-2.5 px-4 rounded-xl text-xs flex items-center justify-center gap-2 transition-colors border border-red-200"
              >
                <Trash2 size={16} /> Discard Current Items & Switch
              </button>
              <button
                type="button"
                onClick={() => setPendingContextChange(null)}
                className="w-full text-gray-500 hover:text-gray-700 font-medium py-2 px-4 rounded-xl text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Review Modal */}
      <ReviewModal
        isOpen={isReviewOpen}
        onClose={() => setIsReviewOpen(false)}
        cartItems={cartItems}
        manualItems={orderForm.formState.manualItems}
        products={products}
        activeBranch={orderForm.activeBranch}
        activeSupplier={orderForm.activeSupplier}
        deliveryDate={orderForm.formState.deliveryDate}
        estimatedTotal={estimatedTotal}
        orderTotals={orderTotals}
        emailOverride={orderForm.formState.emailOverride}
        comments={orderForm.formState.comments}
        onEmailChange={orderForm.setEmailOverride}
        onCommentsChange={orderForm.setComments}
        sendMethod={orderForm.sendMethod}
        isOffline={isOffline}
        isSending={isSending}
        copySuccess={copySuccess}
        onSaveDraft={handleSaveDraft}
        onCopy={handleCopyClipboard}
        onSubmit={handleSubmit}
        submitLabel={submitConfig.label}
        SubmitIcon={submitConfig.icon}
        submitVariant={submitConfig.variant}
      />
    </div>
  );
};

export default PlaceOrder;
