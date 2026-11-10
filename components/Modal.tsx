
import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  className?: string; // For width, padding, etc.
  dismissOnBackdrop?: boolean;
  labelledBy?: string;
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, children, className = '', dismissOnBackdrop = false, labelledBy }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const generatedTitleId = useId();
  const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []).filter(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden');
  useEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const heading = panel?.querySelector<HTMLElement>('h1,h2,h3,h4');
    if (!labelledBy && heading) { heading.id ||= generatedTitleId; panel?.setAttribute('aria-labelledby', heading.id); }
    const timer = window.setTimeout(() => (focusable()[0] || panel)?.focus(), 0);
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || event.defaultPrevented) return;
      // A nested confirmation owns focus until it closes.
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"],dialog[open]')).filter(el => el.getClientRects().length > 0);
      if (dialogs.at(-1) !== panel) return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); panel?.focus(); return; }
      if (!panel?.contains(document.activeElement) || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => { clearTimeout(timer); document.removeEventListener('keydown', trap); if (previous?.isConnected) previous.focus(); };
  }, [isOpen, labelledBy, generatedTitleId]);
  // Lock body scroll
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const hasExplicitOverflow = className.includes('overflow-');
  const hasExplicitMaxHeight = className.includes('max-h-') || className.includes('h-');

  return createPortal(
    <div className="h-admin"><div 
      className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-2 sm:p-4 backdrop-blur-md" 
      onClick={dismissOnBackdrop ? onClose : undefined}
      style={{ margin: 0 }} // Reset any potential margin override
    >
      <div
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`bg-white rounded-2xl shadow-2xl w-full ${hasExplicitMaxHeight ? '' : 'max-h-[90vh]'} ${hasExplicitOverflow ? '' : 'overflow-y-auto custom-scrollbar'} animate-slide-up ${className}`} 
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div></div>,
    document.body
  );
};
