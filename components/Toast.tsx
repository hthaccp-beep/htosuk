
import React from 'react';
import { useAppStore } from '../store';
import { CheckCircle, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';

const ToastItem: React.FC<{
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title?: string;
  message: string;
  onClose: (id: string) => void;
}> = ({ id, type, title, message, onClose }) => {
  
  const styles = {
    success: 'bg-white border-l-4 border-green-500 text-gray-800',
    error: 'bg-white border-l-4 border-red-500 text-gray-800',
    warning: 'bg-white border-l-4 border-orange-500 text-gray-800',
    info: 'bg-white border-l-4 border-blue-500 text-gray-800'
  };

  const icons = {
    success: <CheckCircle className="text-green-500" size={24} />,
    error: <AlertCircle className="text-red-500" size={24} />,
    warning: <AlertTriangle className="text-orange-500" size={24} />,
    info: <Info className="text-blue-500" size={24} />
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-lg shadow-lg shadow-gray-200 border border-gray-100 min-w-[300px] max-w-sm animate-slide-up pointer-events-auto transition-all transform hover:scale-[1.02] ${styles[type]}`}>
      <div className="flex-shrink-0 pt-0.5">{icons[type]}</div>
      <div className="flex-1 min-w-0">
        {title && <h4 className="font-bold text-sm mb-0.5 text-gray-900">{title}</h4>}
        <p className={`text-sm leading-snug ${title ? 'text-gray-600' : 'text-gray-800 font-medium'}`}>{message}</p>
      </div>
      <button onClick={() => onClose(id)} className="text-gray-400 hover:text-gray-600 transition-colors">
        <X size={16} />
      </button>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useAppStore();

  return (
    <div className="fixed z-[100] bottom-4 left-0 right-0 md:bottom-auto md:top-4 md:right-4 md:left-auto flex flex-col items-center md:items-end gap-3 pointer-events-none px-4">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} onClose={removeToast} />
      ))}
    </div>
  );
};
