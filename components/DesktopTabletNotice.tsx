import React from 'react';
import { Monitor, Tablet, ShoppingCart, History, LayoutDashboard, ArrowRight, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store';
import { formatRoleName } from '../constants';

interface DesktopTabletNoticeProps {
  featureName: string;
  description?: string;
  icon?: React.ElementType;
  onContinue?: () => void;
}

export const DesktopTabletNotice: React.FC<DesktopTabletNoticeProps> = ({
  featureName,
  description = 'This management feature is designed for detailed data management, large tables, and reporting on desktop computers and tablets.',
  icon: FeatureIcon = Monitor,
  onContinue,
}) => {
  const navigate = useNavigate();
  const { currentUser, roles } = useAppStore();
  const roleName = currentUser ? formatRoleName(currentUser.role, roles) : 'Authorized User';

  return (
    <div className="min-h-[75vh] flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-3xl border border-gray-200/80 shadow-xl p-6 sm:p-8 text-center space-y-6 animate-fade-in">
        
        {/* Device Graphic Badge */}
        <div className="relative mx-auto w-20 h-20 flex items-center justify-center">
          <div className="absolute inset-0 bg-brand-50 rounded-2xl transform rotate-6 border border-brand-100" />
          <div className="relative w-16 h-16 bg-gradient-to-tr from-brand-600 to-brand-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
            <FeatureIcon size={32} strokeWidth={2.2} />
          </div>
          <div className="absolute -bottom-1 -right-1 bg-white p-1 rounded-full shadow-md border border-gray-100">
            <Tablet size={16} className="text-gray-500" />
          </div>
        </div>

        {/* Informational Copy */}
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-50 rounded-full text-brand-700 text-xs font-bold tracking-tight">
            <Monitor size={14} />
            <span>Desktop & Tablet Feature</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 tracking-tight leading-snug">
            {featureName}
          </h2>
          <p className="text-sm font-semibold text-brand-600">
            This management feature is available on Desktop or Tablet.
          </p>
          <p className="text-xs text-gray-500 leading-relaxed pt-1">
            {description}
          </p>
        </div>

        {/* Permission Confirmation Pill */}
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3.5 flex items-center justify-between text-left">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <ShieldCheck size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-bold text-gray-900 truncate">
                Account Active & Authorized
              </p>
              <p className="text-[10px] text-gray-500 truncate">
                Role: <span className="font-semibold text-gray-800">{roleName}</span> · Log in on desktop for full access.
              </p>
            </div>
          </div>
        </div>

        {/* Operational Quick Actions for Mobile */}
        <div className="space-y-2 pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 text-left px-1">
            Fast Mobile Actions
          </p>
          
          <button
            type="button"
            onClick={() => navigate('/place-order')}
            className="w-full h-12 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-bold text-sm rounded-xl flex items-center justify-between px-4 shadow-md shadow-brand-500/20 transition-all"
          >
            <span className="flex items-center gap-2">
              <ShoppingCart size={18} />
              <span>Create Restaurant Order</span>
            </span>
            <ArrowRight size={16} />
          </button>

          <button
            type="button"
            onClick={() => navigate('/history')}
            className="w-full h-11 bg-white hover:bg-gray-50 active:scale-[0.98] text-gray-700 font-semibold text-xs rounded-xl border border-gray-200 flex items-center justify-between px-4 transition-all"
          >
            <span className="flex items-center gap-2">
              <History size={16} className="text-gray-500" />
              <span>View Order History</span>
            </span>
            <ArrowRight size={14} className="text-gray-400" />
          </button>

          {onContinue && (
            <button
              type="button"
              onClick={onContinue}
              className="w-full h-11 bg-slate-900 hover:bg-black active:scale-[0.98] text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-sm transition-all"
            >
              <span>Continue to {featureName} on this screen</span>
              <ArrowRight size={14} />
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-full h-10 text-gray-500 hover:text-gray-800 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-colors"
          >
            <LayoutDashboard size={14} />
            <span>Return to Dashboard</span>
          </button>
        </div>

      </div>
    </div>
  );
};
