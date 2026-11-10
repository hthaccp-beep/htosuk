
import { useEffect, useRef, useCallback, useState } from 'react';
import { useAppStore } from '../store';
import { addLog } from '../logger';

// 15 Minutes in milliseconds (Security Requirement)
const INACTIVITY_LIMIT = 15 * 60 * 1000; 
// 20 Seconds countdown for UI warning
const WARNING_DURATION = 20;
// LocalStorage key to persist activity across reloads/restarts
const STORAGE_KEY = 'htos_last_active';

export const useAutoLogout = () => {
  const { currentUser, logout } = useAppStore();
  
  // State for the UI
  const [isWarning, setIsWarning] = useState(false);
  const [timeLeft, setTimeLeft] = useState(WARNING_DURATION);

  // Timers
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- ACTIONS ---

  const performLogout = useCallback(() => {
    if (currentUser) {
        addLog('info', '💤 System: Auto-logout triggered due to inactivity');
        // Clear all states
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        
        // Clean up storage so next login starts fresh
        localStorage.removeItem(STORAGE_KEY);
        setIsWarning(false);
        
        logout();
    }
  }, [currentUser, logout]);

  // Called when 15m expires
  const startWarningPhase = useCallback(() => {
    setIsWarning(true);
    setTimeLeft(WARNING_DURATION);
    
    // Start countdown tick
    countdownIntervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // Time up
          if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
          performLogout();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [performLogout]);

  // Called by user interaction (mouse/key) OR button click
  const resetSession = useCallback(() => {
    // 1. Clear existing timers
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

    // 2. Reset UI state
    setIsWarning(false);
    setTimeLeft(WARNING_DURATION);

    // 3. Persist timestamp for app restart handling
    localStorage.setItem(STORAGE_KEY, Date.now().toString());

    // 4. Restart the main timer if user is logged in
    if (currentUser) {
        inactivityTimerRef.current = setTimeout(startWarningPhase, INACTIVITY_LIMIT);
    }
  }, [currentUser, startWarningPhase]);

  // --- EFFECTS ---

  // 1. Initial Load Check: Has it been > 15 mins since last active?
  // This handles the "Close App / Restart Device" scenario.
  useEffect(() => {
    if (!currentUser) return;

    const lastActiveStr = localStorage.getItem(STORAGE_KEY);
    if (lastActiveStr) {
        const lastActive = parseInt(lastActiveStr, 10);
        const elapsed = Date.now() - lastActive;
        
        if (elapsed > INACTIVITY_LIMIT) {
            console.log("Restoring session: Too much time elapsed. Logging out.");
            performLogout();
            return; // Don't setup listeners, we are leaving.
        }
    }

    // If valid, start session
    resetSession();

    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    let lastResetTimestamp = Date.now();

    const onUserActivity = () => {
        const now = Date.now();
        // Throttle resets to max once every 5 seconds for performance
        if (now - lastResetTimestamp > 5000) {
            resetSession();
            lastResetTimestamp = now;
        }
    };

    events.forEach(event => window.addEventListener(event, onUserActivity));

    return () => {
        if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
        events.forEach(event => window.removeEventListener(event, onUserActivity));
    };
  }, [currentUser, performLogout, resetSession]);

  return {
    isWarning,
    timeLeft,
    keepAlive: resetSession,
    logoutNow: performLogout
  };
};
