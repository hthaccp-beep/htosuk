
import React, { useState, useEffect, Suspense, lazy, useRef } from 'react';
import { useAppStore } from './store';
import { Layout } from './components/Layout';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Lock, Loader2, WifiOff, Terminal, Database, Hexagon } from 'lucide-react';
import { can } from './store';
import { auth, db } from './firebase-config';
import { signInWithEmailAndPassword, sendPasswordResetEmail, onAuthStateChanged, signOut } from 'firebase/auth';
import { collection, doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';
import { User } from './types';
import { APP_TITLE, APP_VERSION, APP_SUBTITLE } from './constants';
import { addLog } from './logger';
import { LogViewer } from './components/LogViewer';
import { ToastContainer } from './components/Toast';
import { SessionTimeoutModal } from './components/SessionTimeoutModal'; // Import Modal
import { ErrorBoundary } from './components/ErrorBoundary';
import { DesktopTabletNotice } from './components/DesktopTabletNotice';
import { useFirestoreSync } from './hooks/useFirestoreSync';
import { useAutoLogout } from './hooks/useAutoLogout';
import { getUserSupplierBranches } from './utils/accessControl';

// --- LAZY LOADED COMPONENTS ---
const Dashboard = lazy(() => import('./pages/Dashboard').then(module => ({ default: module.Dashboard })));
const PlaceOrder = lazy(() => import('./pages/PlaceOrder/index').then(module => ({ default: module.PlaceOrder })));
const OrderHistory = lazy(() => import('./pages/OrderHistory').then(module => ({ default: module.OrderHistory })));
const ReceivedOrders = lazy(() => import('./pages/ReceivedOrders').then(module => ({ default: module.ReceivedOrders })));
const Reports = lazy(() => import('./pages/Reports').then(module => ({ default: module.Reports })));
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })));
const PriceManagement = lazy(() => import('./pages/PriceManagement/index').then(module => ({ default: module.PriceManagement })));

// Loading Fallback Component
const PageLoader = () => (
  <div className="h-full w-full flex flex-col items-center justify-center bg-gray-50/50 animate-fade-in">
    <Loader2 className="animate-spin text-brand-500 mb-2" size={32} />
    <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">Loading Module...</span>
  </div>
);

// --- UTILS ---

// Debounce helper
function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  return function(...args: Parameters<T>) {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

// Optimized Mobile Detection
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    // Initial check
    setIsMobile(window.innerWidth < 768);

    const handleResize = debounce(() => {
      setIsMobile(window.innerWidth < 768);
    }, 200);

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
};

interface DesktopOnlyProps {
  children: React.ReactNode;
  featureName?: string;
  description?: string;
}

// Route Wrapper: Shows professional Desktop/Tablet guidance on mobile with option to continue
const DesktopOnly: React.FC<DesktopOnlyProps> = ({ 
  children, 
  featureName = 'Management Module',
  description 
}) => {
  const isMobile = useIsMobile();
  const [bypassed, setBypassed] = useState(false);

  if (isMobile && !bypassed) {
    return (
      <DesktopTabletNotice 
        featureName={featureName} 
        description={description} 
        onContinue={() => setBypassed(true)} 
      />
    );
  }
  return <>{children}</>;
};

// Reliable Online Status
const useOnlineStatus = () => {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      addLog('info', "🌐 Connection Restored");
    };
    const handleOffline = () => {
      setIsOnline(false);
      addLog('warn', "📡 Connection Lost");
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
};

const Login: React.FC<{ accountNotice?: string | null }> = ({ accountNotice }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  
  const isOnline = useOnlineStatus();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResetNotice('');
    
    if (!isOnline) {
       setError("You must be online to sign in. Once signed in, you can work offline.");
       setLoading(false);
       return;
    }

    if (!auth) {
      const msg = "System Configuration Error: Firebase not initialized.";
      setError(msg);
      addLog('error', msg);
      setLoading(false);
      return;
    }

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      setError("Please enter your email address.");
      setLoading(false);
      return;
    }

    if (!trimmedEmail.includes('@')) {
      setError("Please enter your full email address (e.g. you@example.com).");
      setLoading(false);
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, trimmedEmail, password);
      addLog('info', `🔐 Online Login Success: ${trimmedEmail}`);
      // Auth listener in App will handle the redirect
    } catch (err: any) {
      addLog('warn', `Login Failed for ${trimmedEmail}: ${err.code}`);
      console.error(err);
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/invalid-email') {
        setError('Please enter a valid email address (e.g. you@example.com).');
      } else if (err.code === 'auth/user-disabled') {
        setError('Your account is inactive. Please contact an administrator.');
      } else {
        setError('Login Error: ' + err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    setError('');
    setResetNotice('');
    if (!auth || !isOnline) {
      setError('Connect to the internet to reset your password.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setError('Enter your email address above, then select Forgot password.');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setResetNotice('If this email has an account, a password reset link has been sent. Check your inbox and spam folder.');
    } catch (err: any) {
      setError(err.code === 'auth/too-many-requests'
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : 'Unable to request a reset right now. Check your email address and connection, then try again.');
    } finally { setLoading(false); }
  };

  return (
    <div className="h-full w-full flex items-center justify-center p-4 overflow-y-auto relative bg-gradient-to-br from-brand-50 via-white to-brand-100">
      <button 
        onClick={() => setShowLogs(true)}
        className="absolute top-4 right-4 p-2 text-brand-600 hover:text-brand-800 bg-white/50 hover:bg-white rounded-full transition-all shadow z-10"
        title="View System Logs"
      >
        <Terminal size={20} />
      </button>

      <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 w-full max-w-sm p-8">
        <div className="text-center mb-8">
           <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 ${isOnline ? 'bg-gradient-to-tr from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30' : 'bg-gradient-to-tr from-orange-500 to-orange-400 text-white shadow-lg shadow-orange-500/30'}`}>
             {isOnline ? <Hexagon size={32} strokeWidth={2.5} /> : <Database size={28} />}
           </div>
           <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">{APP_TITLE}</h1>
           {APP_SUBTITLE && <p className="text-brand-600 font-semibold mt-1 text-xs uppercase tracking-widest">{APP_SUBTITLE}</p>}
           <div className="mt-4 inline-block px-3 py-1 rounded-full border border-gray-200 bg-white/50 shadow-sm">
              <p className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Version {APP_VERSION}</p>
           </div>
           
           {!isOnline && (
              <div className="mt-4 bg-orange-50 border border-orange-100 text-orange-800 text-xs p-2 rounded-lg font-bold flex items-center justify-center gap-2">
                 <WifiOff size={14} /> Offline Mode Active
              </div>
           )}
        </div>

        {accountNotice && (
          <div className="mb-5 bg-amber-50 border border-amber-200 text-amber-900 text-xs p-3.5 rounded-xl font-medium text-center shadow-sm">
            {accountNotice}
          </div>
        )}
        
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5 ml-1">Email</label>
            <input 
              id="login-email" autoComplete="username" required
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              className="w-full border-0 bg-white/60 focus:bg-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none transition-all shadow-sm" 
              placeholder="user@ht.com"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5 ml-1">
               <label htmlFor="login-password" className="block text-xs font-bold text-gray-500 uppercase tracking-wide">Password</label>
            </div>
            <input 
              id="login-password" autoComplete="current-password" required
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full border-0 bg-white/60 focus:bg-white rounded-xl px-4 py-3 focus:ring-2 focus:ring-brand-500 outline-none transition-all shadow-sm" 
              placeholder="••••••••"
            />
          </div>
          
          {error && <p role="alert" className="text-red-600 text-sm font-medium text-center bg-red-50 p-3 rounded-xl border border-red-100">{error}</p>}
          {resetNotice && <p role="status" className="text-green-800 text-sm text-center bg-green-50 p-3 rounded-xl">{resetNotice}</p>}
          
          <button 
            type="submit" 
            disabled={loading || !isOnline}
            className={`w-full text-white font-bold py-3.5 rounded-xl transition-all shadow-lg flex items-center justify-center ${isOnline ? 'bg-brand-600 hover:bg-brand-700 shadow-brand-500/25 hover:shadow-brand-500/40 hover:-translate-y-0.5' : 'bg-gray-400 cursor-not-allowed'}`}
          >
            {loading ? <Loader2 className="animate-spin" size={20} /> : (isOnline ? 'Sign In Securely' : 'Connect to Internet')}
          </button>
          <button type="button" onClick={handlePasswordReset} disabled={loading || !isOnline}
            className="w-full text-sm font-semibold text-brand-700 hover:underline disabled:opacity-50">
            Forgot password?
          </button>
        </form>
      </div>

      <LogViewer isOpen={showLogs} onClose={() => setShowLogs(false)} />
    </div>
  );
};

const App: React.FC = () => {
  const currentUser = useAppStore((state) => state.currentUser);
  const setCurrentUser = useAppStore((state) => state.setCurrentUser);
  const { branches, logout } = useAppStore(); 
  const [init, setInit] = useState(false);
  const [accountNotice, setAccountNotice] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  // 1. Auth Listener with Realtime Account Status Tracking
  useEffect(() => {
    if (!auth) {
      setInit(true);
      return;
    }

    // Listen for cross-tab session termination events
    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === 'ht_session_event' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed.type === 'deactivated' || parsed.type === 'logout') {
            if (parsed.reason) setAccountNotice(parsed.reason);
            logout();
          }
        } catch (_) {}
      }
    };
    window.addEventListener('storage', handleStorageEvent);

    let userDocUnsub: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, (firebaseUser) => {
      if (userDocUnsub) {
        userDocUnsub();
        userDocUnsub = null;
      }

      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        
        userDocUnsub = onSnapshot(userDocRef, async (userSnap) => {
          if (!userSnap.exists()) {
            // First attempt to auto-link/sync existing profile via server API
            try {
              const token = await firebaseUser.getIdToken();
              const syncRes = await fetch('/api/auth/sync-profile', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                }
              });
              if (syncRes.ok) {
                const data = await syncRes.json();
                if (data.user) {
                  addLog('info', `👤 Auto-linked user profile for ${firebaseUser.email}`);
                  setAccountNotice(null);
                  setCurrentUser({ ...data.user, id: firebaseUser.uid });
                  setInit(true);
                  return;
                }
              }
            } catch (syncErr) {
              console.warn('Auto-sync profile attempt failed:', syncErr);
            }

            // Missing profile: Never grant default role or create fallback profile!
            addLog('warn', `⚠️ Signed-in user ${firebaseUser.email} has no profile document.`);
            setAccountNotice('Your user account profile was not found. Please contact an administrator.');
            await logout();
            setInit(true);
            return;
          }

          const profileData = userSnap.data() as User;
          if (profileData.active !== true) {
            // Account deactivated: Instantly terminate session and clear state!
            addLog('warn', `⚠️ User account ${profileData.username} is deactivated.`);
            setAccountNotice('Your account is inactive. Please contact an administrator.');
            try {
              localStorage.setItem('ht_session_event', JSON.stringify({
                type: 'deactivated',
                reason: 'Your account is inactive. Please contact an administrator.',
                timestamp: Date.now()
              }));
            } catch (_) {}
            await logout();
            setInit(true);
            return;
          }

          // Active, valid account
          setAccountNotice(null);
          const finalUser: User = { ...profileData, id: firebaseUser.uid };
          if (JSON.stringify(useAppStore.getState().currentUser) !== JSON.stringify(finalUser)) {
            addLog('info', `👤 Auth State: Active session for ${finalUser.username} (${finalUser.role})`);
            setCurrentUser(finalUser);
          }
          setInit(true);
        }, async (error) => {
          console.warn("User profile snapshot error:", error);
          if (error.code === 'permission-denied') {
            setAccountNotice('Your account is inactive. Please contact an administrator.');
            await logout();
          }
          setInit(true);
        });
      } else {
        addLog('info', "👤 Auth State: Signed Out");
        setCurrentUser(null);
        setInit(true);
      }
    });

    return () => {
      window.removeEventListener('storage', handleStorageEvent);
      if (userDocUnsub) userDocUnsub();
      unsubAuth();
    };
  }, [setCurrentUser, logout]); 

  // 2. Data Sync (Custom Hook)
  useFirestoreSync(currentUser);

  // 3. Auto Logout with Warning (Security)
  // Destructure state from the hook to drive the UI
  const { isWarning, timeLeft, keepAlive, logoutNow } = useAutoLogout();

  if (!init) return <div className="h-full w-full flex items-center justify-center bg-gray-100"><Loader2 className="animate-spin text-brand-600" size={48} /></div>;

  const supplierBranches = getUserSupplierBranches(currentUser, branches);
  const showReceived = can(currentUser, 'view_received_orders') && supplierBranches.length > 0;

  return (
    <HashRouter>
      <ToastContainer />
      
      {/* Auto Logout Modal */}
      <SessionTimeoutModal 
        isOpen={isWarning} 
        timeLeft={timeLeft} 
        onKeepAlive={keepAlive}
        onLogoutNow={logoutNow}
      />

      {!isOnline && (
        <div className="bg-red-600 text-white text-xs font-bold text-center py-1 flex items-center justify-center gap-2 fixed top-0 w-full z-[60] shadow-md">
          <WifiOff size={12} />
          <span>YOU ARE OFFLINE. Changes will sync when reconnected.</span>
        </div>
      )}
      <ErrorBoundary>
        <Routes>
          <Route 
            path="/login" 
            element={!currentUser ? <Login accountNotice={accountNotice} /> : <Navigate to="/" replace />} 
          />
          <Route 
            path="/" 
            element={currentUser ? <Layout /> : <Navigate to="/login" replace />}
          >
            <Route index element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
            <Route path="place-order" element={can(currentUser, 'place_orders') ? <Suspense fallback={<PageLoader />}><PlaceOrder /></Suspense> : <Navigate to="/" replace />} />
            <Route path="history" element={can(currentUser, 'view_order_history') ? <Suspense fallback={<PageLoader />}><OrderHistory /></Suspense> : <Navigate to="/" replace />} />
            
            <Route path="prices" element={<Suspense fallback={<PageLoader />}><PriceManagement /></Suspense>} />
            
            <Route path="received-orders" element={showReceived ? <Suspense fallback={<PageLoader />}><ReceivedOrders /></Suspense> : <Navigate to="/" replace />} />
            
            <Route path="reports" element={can(currentUser, 'view_reports') ? <DesktopOnly featureName="Analytics & Reports" description="Comprehensive food cost analysis, ingredient inflation metrics, and historical spending reports are optimized for desktop and tablet screens."><Suspense fallback={<PageLoader />}><Reports /></Suspense></DesktopOnly> : <Navigate to="/" replace />} />
            <Route path="admin" element={can(currentUser, 'admin_access') ? <Suspense fallback={<PageLoader />}><Admin /></Suspense> : <Navigate to="/" replace />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </HashRouter>
  );
};

export default App;
