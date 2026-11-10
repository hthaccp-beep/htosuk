import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore, can } from '../../../store';
import { OrderRecord, OrderItem, ManualOrderItem, Branch, Supplier, Product, CartItem } from '../../../types';
import { addLog } from '../../../logger';
import { generateOrderEmailContent, generateOrderPDF } from '../../../utils/orderEmail';
import { generateWhatsAppLink } from '../../../utils/whatsapp';
import { sendEmail, readEmailError, EmailRequestError } from '../../../utils/sendEmail';
import { ORDER_CONSTANTS } from '../PlaceOrder.constants';
import { OrderFormState, SendMethod } from '../PlaceOrder.types';
import { Send, MessageCircle, Download } from 'lucide-react';
import { validateDeliveryDate } from '../../../utils/deliveryScheduler';
import {
  isUserAuthorizedForBranch,
  isSupplierEligibleForOrder,
} from '../../../utils/accessControl';

/**
 * Timeout wrapper that propagates real errors instead of swallowing them.
 */
const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  errorMessage = 'Operation timed out'
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${errorMessage} after ${ms}ms`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timer!);
    return result;
  } catch (e) {
    clearTimeout(timer!);
    throw e;
  }
};

interface UseOrderSubmissionParams {
  formState: OrderFormState;
  activeBranch: Branch | undefined;
  activeSupplier: Supplier | undefined;
  sendMethod: SendMethod;
  resumingDraftId: string | null;
  isOffline: boolean;
  products: Product[];
  onSuccess: () => void;
}

export const useOrderSubmission = ({
  formState,
  activeBranch,
  activeSupplier,
  sendMethod,
  resumingDraftId,
  isOffline,
  products,
  onSuccess,
}: UseOrderSubmissionParams) => {
  const navigate = useNavigate();
  const { 
    currentUser, 
    cart, 
    addOrder, 
    updateOrder,
    deleteOrder, 
    showToast 
  } = useAppStore();

  const [isSending, setIsSending] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const cartItems = Object.values(cart) as CartItem[];

  // --- DERIVED UI STATE ---
  const submitConfig = useMemo(() => {
    if (sendMethod === 'WHATSAPP') {
      return { label: 'WhatsApp', icon: MessageCircle, variant: 'brand' };
    }
    if (isOffline) {
      return { label: 'Save & Download', icon: Download, variant: 'warning' };
    }
    if (sendMethod === 'BOTH') {
      return { label: 'Confirm & Send All', icon: Send, variant: 'brand' };
    }
    return { label: 'Confirm & Send', icon: Send, variant: 'brand' };
  }, [sendMethod, isOffline]);

  // Create order record
  const createOrderRecord = useCallback(
    (status: 'DRAFT' | 'PLACED'): OrderRecord | null => {
      if (!activeBranch || !activeSupplier || !currentUser) return null;

      const items: OrderItem[] = cartItems.map((c) => {
        const prod = products.find((p) => p.id === c.productId);
        return {
          productId: c.productId,
          productNameSnapshot: c.productNameSnapshot || prod?.name || 'Item',
          itemCodeSnapshot: c.itemCodeSnapshot || prod?.itemCode || '',
          caseQty: c.caseQty,
          packQty: c.packQty,
          casePriceSnapshot: c.casePriceSnapshot ?? prod?.casePrice ?? 0,
          packPriceSnapshot: c.packPriceSnapshot ?? prod?.packPrice ?? 0,
          caseUnitSnapshot: c.caseUnitSnapshot || prod?.caseUnitName?.trim() || 'Box',
          packUnitSnapshot: c.packUnitSnapshot || prod?.packUnitName?.trim() || 'Unit',
          vatRate: c.vatRate ?? prod?.vatRate ?? 0,
        };
      });

      // Validate incomplete custom items
      const hasIncomplete = formState.manualItems.some(
        m => (m.description.trim() !== '' && (m.caseQty || 0) <= 0 && (m.packQty || 0) <= 0) ||
             (m.description.trim() === '' && ((m.caseQty || 0) > 0 || (m.packQty || 0) > 0))
      );
      if (hasIncomplete) {
        throw new Error('Please enter both a description and a valid quantity for all custom items, or remove empty lines.');
      }

      const validManualItems: ManualOrderItem[] = formState.manualItems
        .filter((m) => m.description.trim() !== '' && (m.caseQty > 0 || m.packQty > 0))
        .map((m) => {
          const casePrice = m.casePriceSnapshot || 0;
          const packPrice = m.packPriceSnapshot || 0;
          const hasPrice = casePrice > 0 || packPrice > 0;
          return {
            ...m,
            casePriceSnapshot: casePrice,
            packPriceSnapshot: packPrice,
            pricingStatus: m.pricingStatus || (hasPrice ? 'ESTIMATED' : 'UNPRICED'),
            vatRate: m.vatRate || 0,
          };
        });

      if (status === 'PLACED' && items.length === 0 && validManualItems.length === 0) {
        throw new Error('Cannot submit an empty order. Please select at least one item.');
      }

      return {
        id: crypto.randomUUID(),
        branchId: activeBranch.id,
        branchNameSnapshot: activeBranch.name,
        supplierId: activeSupplier.id,
        supplierNameSnapshot: activeSupplier.name,
        orderedByUserId: currentUser.id,
        orderedByNameSnapshot: currentUser.displayName,
        createdAt: new Date().toISOString(),
        deliveryDate: formState.deliveryDate || undefined,
        items,
        manualItems: validManualItems,
        comments: formState.comments,
        emailTo: formState.emailOverride || activeSupplier.email,
        status,
        emailStatus: 'PENDING',
      };
    },
    [activeBranch, activeSupplier, currentUser, cartItems, formState]
  );

  // Save draft - preserves draft and cart on failure
  const handleSaveDraft = useCallback(async () => {
    if (!can(currentUser, 'edit_drafts') && !can(currentUser, 'create_orders')) {
      showToast('error', 'You do not have permission to save or edit drafts.', 'Permission Denied');
      return;
    }

    if (activeBranch && !isUserAuthorizedForBranch(currentUser, activeBranch.id)) {
      showToast('error', 'You are not authorized for this branch.', 'Unauthorized Branch');
      return;
    }

    const order = createOrderRecord('DRAFT');
    if (!order) return;

    try {
      await withTimeout(addOrder(order), ORDER_CONSTANTS.TIMEOUT_DB_SAVE, 'Draft save timed out');
      if (resumingDraftId && resumingDraftId !== order.id) {
        try {
          await deleteOrder(resumingDraftId);
        } catch (_) {}
      }
      showToast('success', 'Draft saved successfully.', 'Draft Saved');
      onSuccess();
      navigate('/history');
    } catch (error: any) {
      console.error('Draft save failed:', error);
      showToast(
        'error',
        `Failed to save draft: ${error?.message || 'Database error'}. Your work is preserved.`,
        'Draft Save Failed'
      );
      addLog('error', `Draft save failed: ${error}`);
      // NOTE: Do NOT call onSuccess() or navigate() on failure; keep local draft intact!
    }
  }, [createOrderRecord, resumingDraftId, deleteOrder, addOrder, showToast, onSuccess, navigate]);

  // Copy to clipboard
  const handleCopyClipboard = useCallback(async () => {
    if (!activeBranch || !activeSupplier) return;

    const dateStr = new Date().toLocaleDateString('en-GB');
    const deliveryStr = formState.deliveryDate
      ? new Date(formState.deliveryDate).toLocaleDateString('en-GB')
      : 'ASAP';

    let text = `NEW ORDER\nBranch: ${activeBranch.name}\nSupplier: ${activeSupplier.name}\nCreated: ${dateStr}\nDelivery: ${deliveryStr}\n\nITEMS:\n`;

    cartItems.forEach((item) => {
      const caseLabel = item.caseUnitSnapshot || 'Box';
      const packLabel = item.packUnitSnapshot || 'Pack';
      const qtyParts = [];
      if (item.caseQty > 0) qtyParts.push(`${item.caseQty} ${caseLabel}`);
      if (item.packQty > 0) qtyParts.push(`${item.packQty} ${packLabel}`);
      if (qtyParts.length > 0) {
        text += `- ${qtyParts.join(' + ')} x ${item.productNameSnapshot}\n`;
      }
    });

    formState.manualItems.forEach((item) => {
      if (item.description && (item.caseQty > 0 || item.packQty > 0)) {
        const caseLabel = item.caseUnitSnapshot || 'Box';
        const packLabel = item.packUnitSnapshot || 'Pack';
        const qtyParts = [];
        if (item.caseQty > 0) qtyParts.push(`${item.caseQty} ${caseLabel}`);
        if (item.packQty > 0) qtyParts.push(`${item.packQty} ${packLabel}`);
        text += `- ${qtyParts.join(' + ')} x ${item.description} (Custom)\n`;
      }
    });

    if (formState.comments) {
      text += `\nNOTES:\n${formState.comments}\n`;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopySuccess(true);
      showToast('success', 'Order details copied to clipboard.');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      showToast('error', 'Failed to copy to clipboard');
    }
  }, [activeBranch, activeSupplier, formState, cartItems, showToast]);

  // Process offline order (PDF download) - verifies persistence before clearing cart
  const processOfflineOrder = useCallback(
    async (order: OrderRecord) => {
      order.emailStatus = 'OFFLINE_MANUAL';

      // 1. MUST persist to database first (offline local cache or remote)
      try {
        await withTimeout(addOrder(order), ORDER_CONSTANTS.TIMEOUT_DB_SAVE, 'Database write timed out');
        if (resumingDraftId) {
          try {
            await deleteOrder(resumingDraftId);
          } catch (_) {}
        }
      } catch (e: any) {
        console.error('DB Save Failed (Offline):', e);
        showToast(
          'error',
          `Could not save order to database: ${e?.message || 'Persistence error'}. Your cart has been preserved.`,
          'Save Failed'
        );
        // STOP: do not wipe cart, do not navigate!
        return;
      }

      // 2. Generate PDF
      try {
        const pdfOp = generateOrderPDF(order, activeBranch!, activeSupplier, products);
        const pdfBase64 = await withTimeout(pdfOp, ORDER_CONSTANTS.TIMEOUT_PDF_GENERATION, 'PDF generation timed out');

        if (pdfBase64) {
          const link = document.createElement('a');
          link.href = `data:application/pdf;base64,${pdfBase64}`;
          link.download = `Order_${order.branchNameSnapshot}_${order.deliveryDate || 'ASAP'}.pdf`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          showToast('warning', 'Order saved to local database (pending sync). Please send PDF manually.', 'Offline Mode');
        } else {
          throw new Error('Empty PDF payload');
        }
      } catch (pdfErr) {
        console.error('PDF Gen Failed', pdfErr);
        showToast('warning', 'Order saved to database, but PDF export failed. You can export PDF from Order History.', 'PDF Export Warning');
      }

      // 3. Cleanup cart now that order is safely persisted
      onSuccess();
      setTimeout(() => navigate('/history'), 100);
    },
    [
      resumingDraftId,
      activeBranch,
      activeSupplier,
      products,
      deleteOrder,
      addOrder,
      showToast,
      onSuccess,
      navigate,
    ]
  );

  // Main submit handler - Enforces strict order of operations and honest completion states
  const handleSubmit = useCallback(async () => {
    // Validate submission permission
    if (!can(currentUser, 'submit_orders')) {
      showToast('error', 'You do not have permission to submit orders.', 'Submission Blocked');
      return;
    }

    if (!activeBranch || !isUserAuthorizedForBranch(currentUser, activeBranch.id)) {
      showToast('error', 'You are not authorized to submit orders for this branch.', 'Unauthorized Branch');
      return;
    }

    if (!isSupplierEligibleForOrder(currentUser, activeSupplier, activeBranch.id, undefined, true)) {
      showToast('error', 'This supplier is not eligible for your current branch.', 'Ineligible Supplier');
      return;
    }

    let order: OrderRecord | null = null;
    try {
      order = createOrderRecord('PLACED');
    } catch (createErr: any) {
      showToast('error', createErr?.message || 'Failed to prepare order record.', 'Order Items Error');
      return;
    }
    if (!order) return;

    // Validate delivery date against supplier schedule, lead time, and cutoffs
    const dateValidation = validateDeliveryDate(order.deliveryDate || '', activeSupplier, activeBranch.id);
    if (!dateValidation.valid) {
      showToast(
        'error',
        dateValidation.error || 'Please select a valid delivery date.',
        'Invalid Delivery Date'
      );
      return;
    }

    setIsSending(true);

    const effectiveOffline = isOffline || !navigator.onLine;
    const useWhatsApp =
      (sendMethod === 'WHATSAPP' || sendMethod === 'BOTH') && activeSupplier?.mobileNumber;
    const useEmail = sendMethod === 'EMAIL' || sendMethod === 'BOTH';

    try {
      // Offline mode handling
      if (effectiveOffline) {
        await processOfflineOrder(order);
        return;
      }

      // -----------------------------------------------------------------------
      // STEP 1: DURABLE DATABASE PERSISTENCE FIRST
      // We NEVER declare an order placed, delete drafts, or clear cart until
      // the order is safely persisted in the database!
      // -----------------------------------------------------------------------
      order.emailStatus = 'PENDING';
      try {
        await withTimeout(addOrder(order), ORDER_CONSTANTS.TIMEOUT_DB_SAVE, 'Database write timed out');
        if (resumingDraftId) {
          try {
            await deleteOrder(resumingDraftId);
          } catch (_) {}
        }
      } catch (dbErr: any) {
        console.error('Database write failed during order submission:', dbErr);
        showToast(
          'error',
          `Order could not be saved to database: ${dbErr?.message || 'Database error'}. Your cart and draft are preserved.`,
          'Database Persistence Failed'
        );
        addLog('error', `Order ${order.id} DB save failed: ${dbErr?.message}`);
        // STOP IMMEDIATELY: Keep cart and form state intact!
        return;
      }

      // -----------------------------------------------------------------------
      // STEP 2: WHATSAPP DISPATCH (if enabled)
      // -----------------------------------------------------------------------
      if (useWhatsApp) {
        const waLink = generateWhatsAppLink(order, activeBranch, activeSupplier?.mobileNumber!);
        window.open(waLink, '_blank');
      }

      // -----------------------------------------------------------------------
      // STEP 3: SUPPLIER EMAIL DISPATCH (if enabled)
      // Distinguishes email transport failure from database persistence failure.
      // -----------------------------------------------------------------------
      if (useEmail) {
        try {
          const { subject, htmlBody } = generateOrderEmailContent(
            order,
            activeBranch,
            activeSupplier,
            products
          );
          const pdfBase64 = await generateOrderPDF(order, activeBranch, activeSupplier, products);
          const recipient = formState.emailOverride || activeSupplier?.email || '';

          const emailPromise = sendEmail({
            purpose: 'order',
            orderId: order.id,
            branchId: activeBranch.id,
            supplierId: order.supplierId,
            to: recipient,
            subject,
            html: htmlBody,
            attachments: [
              {
                filename: `Order_${order.branchNameSnapshot}_${order.deliveryDate || 'ASAP'}.pdf`,
                content: pdfBase64,
                encoding: 'base64',
              },
            ],
          });

          const response = (await withTimeout(
            emailPromise,
            ORDER_CONSTANTS.TIMEOUT_EMAIL_SEND,
            'Supplier email dispatch timed out'
          )) as Response;

          if (!response.ok) {
            throw await readEmailError(response);
          }

          addLog('info', `📧 Email sent to ${recipient} for order ${order.id.slice(0, 8)}`);
          order.emailStatus = 'SENT';
          try {
            await updateOrder(order.id, { emailStatus: 'SENT' });
          } catch (_) {}

          showToast('success', 'Mail server accepted the order email. Please check your branch inbox or spam folder for confirmation.', 'Order Complete');
        } catch (emailErr: any) {
          console.error('Supplier email dispatch failed:', emailErr);
          const isUncertain = emailErr instanceof EmailRequestError && emailErr.status === 502;
          order.emailStatus = isUncertain ? 'UNCERTAIN' : 'FAILED';
          try {
            await updateOrder(order.id, { emailStatus: order.emailStatus });
          } catch (_) {}

          showToast(
            'warning',
            `Order is saved in database, but supplier email ${isUncertain ? 'status is uncertain (mail server timed out)' : 'failed to send'}: ${emailErr?.message || 'Transport error'}. You can resend from Order History or use WhatsApp.`,
            isUncertain ? 'Email Status Uncertain' : 'Email Dispatch Failed'
          );
        }
      } else if (useWhatsApp) {
        // WhatsApp only - keep email status as not sent/skipped and record whatsAppStatus
        order.emailStatus = 'SKIPPED';
        order.whatsAppStatus = 'OPENED';
        try {
          await updateOrder(order.id, { emailStatus: 'SKIPPED', whatsAppStatus: 'OPENED' });
        } catch (_) {}
        showToast('success', 'Order placed and saved. WhatsApp link opened.', 'Order Complete');
      }

      // -----------------------------------------------------------------------
      // STEP 4: CLEANUP CART (Only reached after verified database persistence)
      // -----------------------------------------------------------------------
      onSuccess();
      navigate('/history');
    } catch (criticalErr: any) {
      console.error('Critical Submit Error', criticalErr);
      showToast('error', `Submission error: ${criticalErr?.message || 'Please try again.'}`, 'Error');
    } finally {
      setIsSending(false);
    }
  }, [
    createOrderRecord,
    activeBranch,
    activeSupplier,
    isOffline,
    sendMethod,
    resumingDraftId,
    deleteOrder,
    addOrder,
    updateOrder,
    showToast,
    onSuccess,
    navigate,
    formState,
    products,
    processOfflineOrder,
  ]);

  return {
    isSending,
    copySuccess,
    submitConfig,
    handleSaveDraft,
    handleCopyClipboard,
    handleSubmit,
  };
};
