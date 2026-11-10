
import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, Info, CheckCircle, Loader2, X } from 'lucide-react';

// --- TYPES ---

type ModalType = 'confirm' | 'alert' | 'info' | 'success' | 'warning';
type ModalVariant = 'danger' | 'primary' | 'warning' | 'success';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm?: () => void | Promise<void>;
  title: string;
  message: string | React.ReactNode;
  type?: ModalType;
  confirmText?: string;
  cancelText?: string;
  variant?: ModalVariant;
  /** Show loading spinner on confirm button */
  loading?: boolean;
  /** Disable closing via backdrop click or Escape */
  persistent?: boolean;
  /** Auto-close after confirmation */
  closeOnConfirm?: boolean;
  /** Custom icon override */
  icon?: React.ReactNode;
  /** Additional class for modal container */
  className?: string;
}

// --- VARIANT CONFIGURATIONS ---

const variantConfig: Record<ModalVariant, {
  headerColor: string;
  btnColor: string;
  iconBg: string;
  icon: React.ReactNode;
}> = {
  danger: {
    headerColor: 'text-red-600',
    btnColor: 'bg-red-600 hover:bg-red-700 focus:ring-red-500',
    iconBg: 'bg-red-100',
    icon: <AlertCircle size={24} />,
  },
  primary: {
    headerColor: 'text-brand-600',
    btnColor: 'bg-brand-600 hover:bg-brand-700 focus:ring-brand-500',
    iconBg: 'bg-brand-100',
    icon: <Info size={24} />,
  },
  warning: {
    headerColor: 'text-amber-600',
    btnColor: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    iconBg: 'bg-amber-100',
    icon: <AlertTriangle size={24} />,
  },
  success: {
    headerColor: 'text-green-600',
    btnColor: 'bg-green-600 hover:bg-green-700 focus:ring-green-500',
    iconBg: 'bg-green-100',
    icon: <CheckCircle size={24} />,
  },
};

// --- HELPER: Determine default variant from type ---

const getDefaultVariant = (type: ModalType): ModalVariant => {
  switch (type) {
    case 'confirm':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'success':
      return 'success';
    case 'alert':
    case 'info':
    default:
      return 'primary';
  }
};

// --- HELPER: Determine default button text ---

const getDefaultConfirmText = (type: ModalType, variant: ModalVariant): string => {
  if (type === 'alert' || type === 'info' || type === 'success') {
    return 'OK';
  }
  if (variant === 'danger') {
    return 'Delete';
  }
  return 'Confirm';
};

// --- COMPONENT ---

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  type = 'confirm',
  confirmText,
  cancelText = 'Cancel',
  variant,
  loading = false,
  persistent = false,
  closeOnConfirm = true,
  icon,
  className = '',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);

  // Determine effective variant
  const effectiveVariant = variant || getDefaultVariant(type as ModalType);
  const config = variantConfig[effectiveVariant];

  // Determine if this is an alert-style modal (no cancel button)
  const isAlertType = type === 'alert' || type === 'info' || type === 'success';

  // Final button text
  const finalConfirmText = confirmText || getDefaultConfirmText(type as ModalType, effectiveVariant);

  // --- KEYBOARD HANDLING (Escape to close) ---
  
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isOpen) return;

      // Escape key
      if (e.key === 'Escape' && !persistent && !loading) {
        e.preventDefault();
        onClose();
        return;
      }

      // Tab key - focus trap
      if (e.key === 'Tab') {
        const focusableElements = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );

        if (!focusableElements || focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          // Shift + Tab
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    },
    [isOpen, persistent, loading, onClose]
  );

  // --- EFFECTS ---

  // Add/remove keyboard listener
  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleKeyDown]);

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Focus management - focus confirm button when modal opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        if (isAlertType) {
          confirmBtnRef.current?.focus();
        } else {
          // For confirm dialogs, focus cancel (safer default)
          cancelBtnRef.current?.focus();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen, isAlertType]);

  // --- HANDLERS ---

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only close if clicking the backdrop itself, not modal content
    if (e.target === e.currentTarget && !persistent && !loading) {
      onClose();
    }
  };

  const handleConfirm = async () => {
    if (loading) return;

    if (isAlertType) {
      // Alert type just closes
      onClose();
    } else if (onConfirm) {
      // Confirm type calls the handler
      try {
        await onConfirm();
        if (closeOnConfirm) {
          onClose();
        }
      } catch (error) {
        // Let parent handle errors - don't close on error
        console.error('Confirm action failed:', error);
      }
    }
  };

  // --- RENDER ---

  if (!isOpen) return null;

  return createPortal(
    <div className="h-admin"><div
      className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-fade-in"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      aria-describedby="modal-description"
    >
      <div
        ref={modalRef}
        className={`
          bg-white rounded-2xl shadow-2xl w-full max-w-sm 
          transform transition-all duration-200 ease-out
          animate-scale-in
          ${className}
        `}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 pb-0">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${config.iconBg} ${config.headerColor}`}>
              {icon || config.icon}
            </div>

            {/* Title & Close Button */}
            <div className="flex-1 min-w-0">
              <h3
                id="modal-title"
                className={`text-lg font-bold ${config.headerColor}`}
              >
                {title}
              </h3>
            </div>

            {/* Close button (optional, for non-persistent modals) */}
            {!persistent && !loading && (
              <button
                onClick={onClose}
                className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                aria-label="Close modal"
              >
                <X size={20} />
              </button>
            )}
          </div>

          {/* Message */}
          <div
            id="modal-description"
            className="mt-3 text-gray-600 text-sm leading-relaxed"
          >
            {message}
          </div>
        </div>

        {/* Actions */}
        <div className="p-6 pt-6 flex justify-end gap-3">
          {/* Cancel Button (not shown for alert type) */}
          {!isAlertType && (
            <button
              ref={cancelBtnRef}
              onClick={onClose}
              disabled={loading}
              className="
                px-5 py-2.5 text-gray-700 font-semibold 
                bg-gray-100 hover:bg-gray-200 
                rounded-xl transition-colors text-sm
                focus:outline-none focus:ring-2 focus:ring-gray-300 focus:ring-offset-2
                disabled:opacity-50 disabled:cursor-not-allowed
              "
            >
              {cancelText}
            </button>
          )}

          {/* Confirm Button */}
          <button
            ref={confirmBtnRef}
            onClick={handleConfirm}
            disabled={loading}
            className={`
              px-5 py-2.5 text-white font-semibold 
              rounded-xl shadow-md transition-all text-sm
              focus:outline-none focus:ring-2 focus:ring-offset-2
              disabled:opacity-70 disabled:cursor-not-allowed
              flex items-center justify-center gap-2 min-w-[80px]
              ${config.btnColor}
            `}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Wait...</span>
              </>
            ) : (
              finalConfirmText
            )}
          </button>
        </div>
      </div>
    </div></div>,
    document.body
  );
};
