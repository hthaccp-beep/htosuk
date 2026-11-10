
import React from 'react';
import { Timer, LogOut, CheckCircle } from 'lucide-react';

interface SessionTimeoutModalProps {
  isOpen: boolean;
  timeLeft: number;
  onKeepAlive: () => void;
  onLogoutNow: () => void;
}

export const SessionTimeoutModal: React.FC<SessionTimeoutModalProps> = ({
  isOpen,
  timeLeft,
  onKeepAlive,
  onLogoutNow,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-900/80 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden border-t-4 border-orange-500 animate-scale-in">
        <div className="p-6 text-center">
          <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <Timer size={32} strokeWidth={2.5} />
          </div>
          
          <h2 className="text-xl font-extrabold text-gray-900 mb-2">Session Timeout</h2>
          <p className="text-gray-500 text-sm mb-6">
            For security, you will be automatically signed out in:
          </p>
          
          <div className="text-5xl font-black text-gray-900 mb-6 font-mono tracking-tight">
            00:{timeLeft.toString().padStart(2, '0')}
          </div>

          <div className="space-y-3">
            <button
              onClick={onKeepAlive}
              className="w-full py-3.5 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-brand-200 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <CheckCircle size={18} />
              Stay Signed In
            </button>
            
            <button
              onClick={onLogoutNow}
              className="w-full py-3 px-4 text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl font-bold text-xs transition-colors flex items-center justify-center gap-2"
            >
              <LogOut size={16} />
              Sign Out Now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
