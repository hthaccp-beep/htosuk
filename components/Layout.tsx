
import React, { useState, useEffect } from 'react';
import { useAppStore, can } from '../store';
import { 
  LogOut, LayoutDashboard, ShoppingCart, History, Settings, PieChart, 
  Inbox, Hexagon, ChevronLeft, ChevronRight, ScanLine, 
  Menu, X, ArrowRight
} from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { APP_TITLE, APP_SUBTITLE, formatRoleName } from '../constants';
import { getUserSupplierBranches } from '../utils/accessControl';

export const Layout: React.FC = () => {
  const { currentUser, roles, branches, priceChangeNotices, newItemNotices, logout } = useAppStore();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Collapsed by default on tablet (<1024px) to maximize screen real estate, expanded on desktop (>=1024px)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });
  const [hasManuallyToggled, setHasManuallyToggled] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleResize = () => {
      if (!hasManuallyToggled) {
        setIsSidebarCollapsed(window.innerWidth < 1024);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [hasManuallyToggled]);

  const toggleSidebar = () => {
    setHasManuallyToggled(true);
    setIsSidebarCollapsed(prev => !prev);
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // Desktop Navigation Item Class
  const getNavClass = ({ isActive }: { isActive: boolean }) => 
    isSidebarCollapsed
      ? `flex flex-col items-center justify-center py-2 px-1 text-center rounded-xl mb-1.5 transition-all group relative focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
          isActive 
            ? 'bg-brand-50 text-brand-600 shadow-xs border border-brand-100 font-bold' 
            : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900 font-semibold'
        }`
      : `flex items-center space-x-3 px-3 py-2.5 text-sm font-semibold transition-all duration-200 rounded-xl mb-1 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
          isActive 
            ? 'bg-brand-50 text-brand-600 shadow-xs border border-brand-100 font-bold' 
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`;

  // Mobile Navigation Item Class
  const getMobileNavClass = ({ isActive }: { isActive: boolean }) => 
    `flex flex-col items-center justify-center w-full py-1.5 transition-all relative active:scale-95 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none ${
      isActive ? 'text-brand-600' : 'text-gray-400 hover:text-gray-500'
    }`;

  if (!currentUser) return null;

  const userRoleName = formatRoleName(currentUser.role, roles);
  const myBranch = branches.find(b => b.id === currentUser.branchId);
  const supplierBranches = getUserSupplierBranches(currentUser, branches);
  
  // Show Incoming page only if user has permission AND is assigned to a branch marked as supplier
  const showReceivedOrders = can(currentUser, 'view_received_orders') && supplierBranches.length > 0;

  const pendingPriceApprovals = 
    priceChangeNotices.filter(n => n.status === 'PENDING').length + 
    newItemNotices.filter(n => n.status === 'PENDING').length;

  const showPriceMonitor = 
    can(currentUser, 'scan_invoices') || 
    can(currentUser, 'view_price_changes') || 
    can(currentUser, 'approve_price_changes') || 
    can(currentUser, 'view_price_history');

  return (
    <div className="h-full w-full bg-slate-50 flex overflow-hidden font-sans text-gray-900">
      {/* Desktop / Tablet Sidebar */}
      <aside className={`hidden md:flex flex-col ${isSidebarCollapsed ? 'w-20' : 'w-64'} bg-white border-r border-gray-200 h-full flex-shrink-0 z-20 shadow-sm transition-all duration-300 select-none`}>
        {isSidebarCollapsed ? (
          <div className="p-3 border-b border-gray-100 flex flex-col items-center justify-center relative">
            <div className="w-10 h-10 bg-gradient-to-tr from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-brand-500/20 mb-1.5" title={APP_TITLE}>
              <Hexagon size={22} strokeWidth={2.5} />
            </div>
            <button 
              onClick={toggleSidebar} 
              className="p-1 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors"
              title="Expand Sidebar"
              aria-label="Expand Sidebar"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        ) : (
          <div className="p-4 lg:p-5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-gradient-to-tr from-brand-500 to-brand-600 rounded-xl flex items-center justify-center text-white shadow-md shadow-brand-500/20 flex-shrink-0">
                <Hexagon size={24} strokeWidth={2.5} />
              </div>
              <div className="min-w-0">
                <h1 className="text-lg font-extrabold text-gray-900 tracking-tight leading-none truncate">{APP_TITLE}</h1>
                {APP_SUBTITLE && <p className="text-[10px] text-brand-600 font-bold uppercase tracking-widest mt-1 truncate">{APP_SUBTITLE}</p>}
              </div>
            </div>
            <button 
              onClick={toggleSidebar} 
              className="p-1.5 text-gray-400 hover:text-brand-600 hover:bg-brand-50 rounded-lg transition-colors flex-shrink-0 ml-1"
              title="Collapse Sidebar"
              aria-label="Collapse Sidebar"
            >
              <ChevronLeft size={16} />
            </button>
          </div>
        )}
        
        <nav className={`flex-1 py-4 space-y-1 overflow-y-auto custom-scrollbar ${isSidebarCollapsed ? 'px-2' : 'px-3'}`}>
          <NavLink to="/" className={getNavClass} end title="Dashboard">
            <LayoutDashboard size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
            {isSidebarCollapsed ? (
              <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Dashboard</span>
            ) : (
              <span>Dashboard</span>
            )}
          </NavLink>
          
          {can(currentUser, 'place_orders') && (
            <NavLink to="/place-order" className={getNavClass} title="Place Order">
              <ShoppingCart size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Order</span>
              ) : (
                <span>Place Order</span>
              )}
            </NavLink>
          )}
          
          {can(currentUser, 'view_order_history') && (
            <NavLink to="/history" className={getNavClass} title="Order History">
              <History size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">History</span>
              ) : (
                <span>Order History</span>
              )}
            </NavLink>
          )}

          {showPriceMonitor && (
            <NavLink to="/prices" className={getNavClass} title="Invoice & Price Monitor">
              <div className="relative flex items-center justify-center">
                <ScanLine size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
                {pendingPriceApprovals > 0 && isSidebarCollapsed && (
                  <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                )}
              </div>
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Prices</span>
              ) : (
                <div className="flex items-center justify-between w-full">
                  <span>Price Monitor</span>
                  {pendingPriceApprovals > 0 && (
                    <span className="bg-red-500 text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full animate-pulse shadow-sm">
                      {pendingPriceApprovals}
                    </span>
                  )}
                </div>
              )}
            </NavLink>
          )}

          {showReceivedOrders && (
            <NavLink to="/received-orders" className={getNavClass} title="Incoming Orders">
              <Inbox size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Incoming</span>
              ) : (
                <span>Incoming Orders</span>
              )}
            </NavLink>
          )}

          {can(currentUser, 'view_reports') && (
            <NavLink to="/reports" className={getNavClass} title="Analytics & Reports">
              <PieChart size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Analytics</span>
              ) : (
                <span>Analytics</span>
              )}
            </NavLink>
          )}

          {can(currentUser, 'admin_access') && (
            <NavLink to="/admin" className={getNavClass} title="Administration">
              <Settings size={isSidebarCollapsed ? 20 : 18} strokeWidth={2.5} />
              {isSidebarCollapsed ? (
                <span className="text-[10px] font-bold tracking-tight text-center leading-tight mt-1 truncate max-w-[68px]">Admin</span>
              ) : (
                <span>Administration</span>
              )}
            </NavLink>
          )}
        </nav>

        {isSidebarCollapsed ? (
          <div className="p-2 border-t border-gray-100 mt-auto bg-gray-50/50 flex flex-col items-center">
            <div 
              className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-extrabold text-sm shadow-xs mb-2" 
              title={`${currentUser.displayName} (${userRoleName})`}
            >
              {currentUser.username[0].toUpperCase()}
            </div>
            <div className="flex flex-col items-center w-full">
              <button 
                type="button"
                onClick={handleLogout} 
                className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
                title="Sign Out"
                aria-label="Sign Out"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3.5 border-t border-gray-100 mt-auto bg-gray-50/50">
            <div className="bg-white rounded-xl p-3 border border-gray-200 shadow-xs">
              <div className="flex items-center space-x-3 mb-2.5">
                <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700 font-extrabold text-sm shadow-xs flex-shrink-0">
                  {currentUser.username[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-gray-900 truncate">{currentUser.displayName}</p>
                  <p className="text-[10px] text-brand-600 font-bold uppercase tracking-wider truncate">{userRoleName}</p>
                </div>
              </div>
              
              <button 
                type="button"
                onClick={handleLogout} 
                className="w-full flex items-center justify-center space-x-2 bg-gray-50 hover:bg-red-50 border border-gray-200 hover:border-red-200 hover:text-red-600 text-gray-600 py-1.5 px-3 rounded-lg transition-all duration-200 font-bold text-xs shadow-2xs active:scale-95 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
              >
                <LogOut size={13} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Wrapper */}
      <div className="flex-1 flex flex-col h-full overflow-hidden w-full">
        
        {/* Mobile Header */}
        <header className="md:hidden bg-white/90 backdrop-blur-xl border-b border-gray-200 h-14 flex-shrink-0 z-30 flex items-center justify-between px-4 sticky top-0 shadow-xs">
          <div className="flex items-center gap-3">
             <div className="w-8 h-8 bg-gradient-to-tr from-brand-500 to-brand-400 rounded-lg flex items-center justify-center text-white font-extrabold text-xs shadow-md shadow-brand-500/20">
               <Hexagon size={20} strokeWidth={2.5} />
             </div>
             <div className="flex flex-col">
               <h1 className="text-sm font-extrabold text-gray-900 leading-tight tracking-tight">{APP_TITLE}</h1>
               <p className="text-[10px] text-brand-600 font-bold uppercase tracking-widest">{currentUser.displayName}</p>
             </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold shadow-2xs ${
              isOnline 
                ? 'border-emerald-200 bg-white text-emerald-700' 
                : 'border-amber-300 bg-amber-50 text-amber-800'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span>{isOnline ? 'Online' : 'Offline'}</span>
            </div>
            <button 
              type="button"
              onClick={handleLogout} 
              className="p-2 bg-gray-50 text-gray-500 rounded-xl hover:bg-red-50 hover:text-red-600 transition-colors active:scale-90 border border-gray-100 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
              aria-label="Sign Out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <main className="flex-1 overflow-y-auto scroll-auto w-full bg-slate-50 md:p-2 lg:p-3 transition-all duration-300">
           {/* Padding calculation handles Mobile Fixed Nav + iOS Safe Area */}
           <div className="w-full h-full p-2 sm:p-2.5 pb-[calc(70px+env(safe-area-inset-bottom))] md:pb-0 md:p-0 max-w-7xl mx-auto">
             <Outlet />
           </div>
        </main>

        {/* Mobile Bottom Nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-2xl border-t border-gray-200 z-50 flex items-center justify-around px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 shadow-[0_-8px_30px_rgba(0,0,0,0.06)]">
          <NavLink to="/" className={getMobileNavClass} end title="Dashboard">
            {({ isActive }) => (
              <div className="flex flex-col items-center">
                <div className={`p-1.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-brand-50 text-brand-600 shadow-xs' : 'text-gray-400'}`}>
                  <LayoutDashboard size={20} strokeWidth={isActive ? 2.5 : 2} className={isActive ? "fill-brand-100/50" : ""} />
                </div>
                <span className={`text-[9px] font-bold mt-0.5 ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>Home</span>
              </div>
            )}
          </NavLink>
          
          {can(currentUser, 'place_orders') && (
            <NavLink to="/place-order" className={getMobileNavClass} title="Place Order">
              {({ isActive }) => (
                <div className="flex flex-col items-center">
                  <div className={`p-1.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30' : 'text-gray-500 bg-gray-100'}`}>
                    <ShoppingCart size={20} strokeWidth={2.5} />
                  </div>
                  <span className={`text-[9px] font-bold mt-0.5 ${isActive ? 'text-brand-600 font-black' : 'text-gray-500'}`}>Order</span>
                </div>
              )}
            </NavLink>
          )}

          {can(currentUser, 'view_order_history') && (
            <NavLink to="/history" className={getMobileNavClass} title="Order History">
              {({ isActive }) => (
                <div className="flex flex-col items-center">
                  <div className={`p-1.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-brand-50 text-brand-600 shadow-xs' : 'text-gray-400'}`}>
                    <History size={20} strokeWidth={isActive ? 2.5 : 2} />
                  </div>
                  <span className={`text-[9px] font-bold mt-0.5 ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>History</span>
                </div>
              )}
            </NavLink>
          )}

          {showPriceMonitor && (
            <NavLink to="/prices" className={getMobileNavClass} title="Prices">
              {({ isActive }) => (
                <div className="flex flex-col items-center">
                  <div className={`p-1.5 rounded-xl transition-all duration-200 relative ${isActive ? 'bg-brand-50 text-brand-600 shadow-xs' : 'text-gray-400'}`}>
                    <ScanLine size={20} strokeWidth={isActive ? 2.5 : 2} />
                    {pendingPriceApprovals > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-white animate-pulse" />
                    )}
                  </div>
                  <span className={`text-[9px] font-bold mt-0.5 ${isActive ? 'text-brand-600' : 'text-gray-400'}`}>Prices</span>
                </div>
              )}
            </NavLink>
          )}

          {/* Mobile More / Features Drawer Button */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center w-full py-1.5 transition-all text-gray-400 hover:text-gray-600 active:scale-95"
            title="More Options"
          >
            <div className="p-1.5 rounded-xl relative text-gray-400">
              <Menu size={20} strokeWidth={2} />
              {(pendingPriceApprovals > 0 || (can(currentUser, 'admin_access') && branches.length > 0)) && (
                <span className="absolute 0 top-1 right-1 w-2 h-2 rounded-full bg-brand-500 ring-2 ring-white" />
              )}
            </div>
            <span className="text-[9px] font-bold mt-0.5 text-gray-400">More</span>
          </button>
        </nav>
      </div>

      {/* Mobile Drawer / Slide-Over Menu */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[70] flex flex-col justify-end bg-black/60 backdrop-blur-sm animate-fade-in">
          <div 
            className="flex-1" 
            onClick={() => setIsMobileMenuOpen(false)}
          />
          <div className="bg-white rounded-t-3xl border-t border-gray-200 max-h-[85vh] overflow-y-auto overscroll-contain shadow-2xl p-4 pb-[calc(24px+env(safe-area-inset-bottom))] animate-slide-up space-y-4">
            
            {/* Header & User Info */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-brand-600 to-brand-500 text-white font-extrabold flex items-center justify-center text-sm shadow-md shadow-brand-500/20">
                  {currentUser.username[0].toUpperCase()}
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-gray-900 leading-tight">{currentUser.displayName}</h3>
                  <p className="text-[11px] text-brand-600 font-bold uppercase tracking-wider">
                    {userRoleName} · {myBranch?.name || 'All Locations'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-2 text-gray-400 hover:text-gray-600 bg-gray-100 rounded-full"
              >
                <X size={18} />
              </button>
            </div>

            {/* Operational Links */}
            <div className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block px-2 mb-1">
                Operational Functions
              </span>

              <button
                type="button"
                onClick={() => { setIsMobileMenuOpen(false); navigate('/place-order'); }}
                className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 text-left transition-colors font-bold text-xs text-gray-800"
              >
                <span className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center">
                    <ShoppingCart size={16} />
                  </div>
                  <span>Create / Place Order</span>
                </span>
                <ArrowRight size={14} className="text-gray-400" />
              </button>

              <button
                type="button"
                onClick={() => { setIsMobileMenuOpen(false); navigate('/history'); }}
                className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 text-left transition-colors font-bold text-xs text-gray-800"
              >
                <span className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                    <History size={16} />
                  </div>
                  <span>Order History & Tracking</span>
                </span>
                <ArrowRight size={14} className="text-gray-400" />
              </button>

              {showReceivedOrders && (
                <button
                  type="button"
                  onClick={() => { setIsMobileMenuOpen(false); navigate('/received-orders'); }}
                  className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 text-left transition-colors font-bold text-xs text-gray-800"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                      <Inbox size={16} />
                    </div>
                    <span>Incoming / Delivery Notes</span>
                  </span>
                  <ArrowRight size={14} className="text-gray-400" />
                </button>
              )}
            </div>

            {/* Management & Administration (Desktop / Tablet) */}
            <div className="space-y-1 pt-2 border-t border-gray-100">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 block px-2 mb-1">
                Management Features (Desktop & Tablet)
              </span>

              {can(currentUser, 'view_reports') && (
                <button
                  type="button"
                  onClick={() => { setIsMobileMenuOpen(false); navigate('/reports'); }}
                  className="w-full flex items-center justify-between p-3 rounded-2xl hover:bg-gray-50 active:bg-gray-100 text-left transition-colors font-bold text-xs text-gray-800"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
                      <PieChart size={16} />
                    </div>
                    <div>
                      <span>Analytics & Cost Reports</span>
                      <span className="block text-[9px] text-gray-400 font-normal">Desktop / Tablet optimized</span>
                    </div>
                  </span>
                  <div className="flex items-center gap-1.5 text-gray-400">
                    <ArrowRight size={14} />
                  </div>
                </button>
              )}

              {can(currentUser, 'admin_access') && (
                <button
                  type="button"
                  onClick={() => { setIsMobileMenuOpen(false); navigate('/admin'); }}
                  className="w-full flex items-center justify-between p-3 rounded-2xl bg-amber-50/70 hover:bg-amber-100 active:bg-amber-200 text-left transition-colors font-bold text-xs text-amber-950 border border-amber-200/60"
                >
                  <span className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shadow-xs">
                      <Settings size={16} />
                    </div>
                    <div>
                      <span className="font-extrabold text-sm">System Administration</span>
                      <span className="block text-[10px] text-amber-800 font-medium">Data transfer, products, users & settings</span>
                    </div>
                  </span>
                  <div className="flex items-center gap-1.5 text-amber-700">
                    <ArrowRight size={16} />
                  </div>
                </button>
              )}
            </div>

            {/* Session Actions */}
            <div className="pt-3 border-t border-gray-100 flex items-center">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full py-3 px-4 bg-red-50 hover:bg-red-100 active:bg-red-200 text-red-600 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors border border-red-200/60 focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:outline-none"
              >
                <LogOut size={16} /> Sign Out Securely
              </button>
            </div>

          </div>
        </div>
      )}
    </div>
  );
};
