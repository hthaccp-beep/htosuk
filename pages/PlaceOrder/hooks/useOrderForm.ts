
import { useState, useCallback, useMemo, useEffect } from 'react';
import { useAppStore, can } from '../../../store';
import { useLocation } from 'react-router-dom';
import { OrderFormState, ManualOrderItem } from '../PlaceOrder.types';
import { ORDER_CONSTANTS } from '../PlaceOrder.constants';
import { 
  getCutoffStatus, 
  validateDeliveryDate, 
  getNextAvailableDeliveryDate,
  CutoffStatus,
  ValidationResult 
} from '../../../utils/deliveryScheduler';
import {
  getUserAuthorizedBranches,
  filterSuppliersForOrdering,
  isUserAuthorizedForBranch,
} from '../../../utils/accessControl';

export const useOrderForm = () => {
  const { currentUser, branches, suppliers, showToast } = useAppStore();
  const location = useLocation();
  const canViewGlobal = can(currentUser, 'view_global_data');

  // Clock state: updates every 15s to drive live countdowns
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);

  // Compute authorized branches for current user
  const authorizedBranches = useMemo(() => {
    return getUserAuthorizedBranches(currentUser, branches);
  }, [currentUser, branches]);

  // Initial State Helpers
  const getDefaultBranchId = useCallback(() => {
    if (authorizedBranches.length === 1) return authorizedBranches[0].id;
    if (currentUser?.branchId && authorizedBranches.some(b => b.id === currentUser.branchId)) {
      return currentUser.branchId;
    }
    return authorizedBranches[0]?.id || '';
  }, [authorizedBranches, currentUser]);

  const [hasExplicitlyChosenBranch, setHasExplicitlyChosenBranch] = useState(false);

  const [formState, setFormState] = useState<OrderFormState>({
    selectedBranchId: getDefaultBranchId(),
    selectedSupplierId: '',
    deliveryDate: '',
    comments: '',
    emailOverride: '',
    manualItems: [],
  });

  const [resumingDraftId, setResumingDraftId] = useState<string | null>(null);

  // Initialize from Location State (Resume Draft)
  useEffect(() => {
    if (location.state) {
      const state = location.state as any;
      setFormState(prev => ({
        ...prev,
        selectedBranchId: state.branchId || prev.selectedBranchId,
        selectedSupplierId: state.supplierId || prev.selectedSupplierId,
        deliveryDate: state.deliveryDate || prev.deliveryDate,
        comments: state.comments || prev.comments,
        emailOverride: state.emailTo || prev.emailOverride,
        manualItems: state.manualItems || prev.manualItems,
      }));
      if (state.branchId) {
        setHasExplicitlyChosenBranch(true);
      }
      if (state.draftId) {
        setResumingDraftId(state.draftId);
      }
    }
  }, [location]);

  // Ensure default selections if lists load late or selected branch is not authorized
  useEffect(() => {
    setFormState(prev => {
      let nextBranch = prev.selectedBranchId;
      if ((!nextBranch || !authorizedBranches.some(b => b.id === nextBranch)) && authorizedBranches.length > 0) {
        nextBranch = getDefaultBranchId();
      }
      if (nextBranch !== prev.selectedBranchId) {
        return { ...prev, selectedBranchId: nextBranch };
      }
      return prev;
    });
  }, [authorizedBranches, getDefaultBranchId]);

  // Derived Data: Authorized & Eligible Suppliers based on selected branch
  const eligibleSuppliers = useMemo(() => {
    return filterSuppliersForOrdering(
      currentUser,
      suppliers,
      formState.selectedBranchId,
      undefined,
      can(currentUser, 'create_orders')
    );
  }, [currentUser, suppliers, formState.selectedBranchId]);

  // Reconcile selected supplier when eligible list updates
  useEffect(() => {
    if (eligibleSuppliers.length > 0) {
      if (!eligibleSuppliers.some(s => s.id === formState.selectedSupplierId)) {
        setFormState(prev => ({ ...prev, selectedSupplierId: eligibleSuppliers[0].id }));
      }
    } else {
      if (formState.selectedSupplierId) {
        setFormState(prev => ({ ...prev, selectedSupplierId: '' }));
      }
    }
  }, [eligibleSuppliers, formState.selectedSupplierId]);

  const activeBranch = useMemo(
    () => branches.find(b => b.id === formState.selectedBranchId),
    [branches, formState.selectedBranchId]
  );

  const activeSupplier = useMemo(
    () => suppliers.find(s => s.id === formState.selectedSupplierId),
    [suppliers, formState.selectedSupplierId]
  );

  const sendMethod = useMemo(
    () => activeSupplier?.preferredMethod || 'EMAIL',
    [activeSupplier]
  );

  const deliveryScheduleText = useMemo(() => {
    if (!activeSupplier?.deliverySchedules) return null;
    return (
      activeSupplier.deliverySchedules[formState.selectedBranchId] ||
      activeSupplier.deliverySchedules['default'] ||
      null
    );
  }, [activeSupplier, formState.selectedBranchId]);

  // Cutoff Status & Countdown Clock
  const cutoffStatus: CutoffStatus = useMemo(() => {
    return getCutoffStatus(activeSupplier, formState.selectedBranchId, clock);
  }, [activeSupplier, formState.selectedBranchId, clock]);

  // Initialize delivery date to earliest valid delivery date if unset
  useEffect(() => {
    if (!formState.deliveryDate && cutoffStatus.nextValidDeliveryDate) {
      setFormState(prev => ({ ...prev, deliveryDate: cutoffStatus.nextValidDeliveryDate }));
    }
  }, [cutoffStatus.nextValidDeliveryDate, formState.deliveryDate]);

  // Validate currently selected delivery date
  const deliveryDateValidation: ValidationResult = useMemo(() => {
    if (!formState.deliveryDate) return { valid: false, error: 'Delivery date is required.' };
    return validateDeliveryDate(formState.deliveryDate, activeSupplier, formState.selectedBranchId, clock);
  }, [formState.deliveryDate, activeSupplier, formState.selectedBranchId, clock]);

  const dateHelpers = useMemo(() => {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfter = new Date(today);
    dayAfter.setDate(today.getDate() + 2);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    const formatLabel = (d: Date) =>
      d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });

    return {
      todayStr: formatDate(today),
      tomorrowStr: formatDate(tomorrow),
      dayAfterStr: formatDate(dayAfter),
      tomorrowLabel: formatLabel(tomorrow),
      dayAfterLabel: formatLabel(dayAfter),
      earliestStr: cutoffStatus.nextValidDeliveryDate,
      earliestLabel: cutoffStatus.nextValidDeliveryLabel,
    };
  }, [cutoffStatus.nextValidDeliveryDate, cutoffStatus.nextValidDeliveryLabel]);

  // Actions with authorization enforcement
  const setBranchId = useCallback((id: string) => {
    if (!isUserAuthorizedForBranch(currentUser, id)) {
      showToast('error', 'You are not authorized to order for this branch.');
      return;
    }
    setHasExplicitlyChosenBranch(true);
    setFormState(prev => ({ ...prev, selectedBranchId: id }));
  }, [currentUser, showToast]);

  const setSupplierId = useCallback((id: string) => {
    setFormState(prev => {
      const newSup = suppliers.find(s => s.id === id);
      const nextDate = getNextAvailableDeliveryDate(newSup, prev.selectedBranchId, new Date());
      return { 
        ...prev, 
        selectedSupplierId: id,
        deliveryDate: nextDate.dateStr 
      };
    });
  }, [suppliers]);

  const setDeliveryDate = useCallback((date: string) => {
    setFormState(prev => ({ ...prev, deliveryDate: date }));
  }, []);

  const setComments = useCallback((comments: string) => {
    setFormState(prev => ({ ...prev, comments }));
  }, []);

  const setEmailOverride = useCallback((email: string) => {
    setFormState(prev => ({ ...prev, emailOverride: email }));
  }, []);

  const addManualItem = useCallback(() => {
    setFormState(prev => {
      if (prev.manualItems.length >= ORDER_CONSTANTS.MAX_MANUAL_ITEMS) return prev;
      return {
        ...prev,
        manualItems: [
          ...prev.manualItems,
          {
            id: `manual-${Date.now()}`,
            description: '',
            caseQty: 0,
            packQty: 0,
          },
        ],
      };
    });
  }, []);

  const updateManualItem = useCallback(
    (index: number, field: keyof ManualOrderItem, value: string | number) => {
      setFormState(prev => {
        const newItems = [...prev.manualItems];
        if (!newItems[index]) return prev;

        if (field === 'caseQty' || field === 'packQty') {
          let qty = typeof value === 'string' 
            ? parseInt(value.replace(/[^0-9]/g, ''), 10) 
            : value;
          
          if (isNaN(qty) || qty < 0) qty = 0;
          if (qty > ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM) {
            qty = ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM;
            showToast('warning', `Max limit is ${ORDER_CONSTANTS.MAX_QUANTITY_PER_ITEM}`, "High Quantity");
          }
          newItems[index] = { ...newItems[index], [field]: qty };
        } else {
          // @ts-ignore
          newItems[index] = { ...newItems[index], [field]: value };
        }

        return { ...prev, manualItems: newItems };
      });
    },
    [showToast]
  );

  const removeManualItem = useCallback((index: number) => {
    setFormState(prev => ({
      ...prev,
      manualItems: prev.manualItems.filter((_, i) => i !== index),
    }));
  }, []);

  const resetForm = useCallback(() => {
    setFormState({
      selectedBranchId: getDefaultBranchId(),
      selectedSupplierId: eligibleSuppliers[0]?.id || '',
      deliveryDate: '',
      comments: '',
      emailOverride: '',
      manualItems: [],
    });
    setResumingDraftId(null);
  }, [getDefaultBranchId, eligibleSuppliers]);

  // Prompt condition: User has multiple authorized branches and hasn't explicitly selected one yet
  const needsBranchConfirmation = authorizedBranches.length > 1 && !hasExplicitlyChosenBranch;

  return {
    formState,
    resumingDraftId,
    activeBranch,
    activeSupplier,
    authorizedBranches,
    eligibleSuppliers,
    needsBranchConfirmation,
    sendMethod,
    deliveryScheduleText,
    cutoffStatus,
    deliveryDateValidation,
    dateHelpers,
    canViewGlobal,
    setBranchId,
    setSupplierId,
    setDeliveryDate,
    setComments,
    setEmailOverride,
    addManualItem,
    updateManualItem,
    removeManualItem,
    resetForm,
    setResumingDraftId,
  };
};
