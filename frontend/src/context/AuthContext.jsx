import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { authApi, setUnauthorizedHandler } from '../services/api';
import { setSanctuaryAuthUser } from '../services/sanctuaryDataService';
import { syncGlobalPreferencesFromServer } from '../services/preferencesService';

const AuthContext = createContext(null);

export function AuthProvider({ children, onSessionExpired = null }) {
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const stored = localStorage.getItem('aks_auth_user');
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const [isGuest, setIsGuest] = useState(() => {
    try {
      if (localStorage.getItem('aks_auth_user')) return false;
      return (
        localStorage.getItem('aks_guest_mode') === 'true' ||
        sessionStorage.getItem('aks_guest_mode') === 'true'
      );
    } catch {
      return false;
    }
  });

  const [isAuthChecking, setIsAuthChecking] = useState(true);

  // Synchronize state with backend session on mount
  useEffect(() => {
    let isMounted = true;

    authApi
      .getCurrentUser()
      .then((user) => {
        if (!isMounted) return;
        if (user) {
          setCurrentUser(user);
          setIsGuest(false);
          setSanctuaryAuthUser(user);
          try {
            sessionStorage.removeItem('aks_guest_mode');
            localStorage.removeItem('aks_guest_mode');
            localStorage.setItem('aks_auth_user', JSON.stringify(user));
          } catch (_) {}
          syncGlobalPreferencesFromServer().catch(() => {});
        } else {
          setCurrentUser(null);
          setSanctuaryAuthUser(null);
          const guestActive =
            localStorage.getItem('aks_guest_mode') === 'true' ||
            sessionStorage.getItem('aks_guest_mode') === 'true';
          setIsGuest(guestActive);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setCurrentUser(null);
        setSanctuaryAuthUser(null);
        const guestActive =
          localStorage.getItem('aks_guest_mode') === 'true' ||
          sessionStorage.getItem('aks_guest_mode') === 'true';
        setIsGuest(guestActive);
      })
      .finally(() => {
        if (isMounted) setIsAuthChecking(false);
      });

    // Centralized 401 unauth handler
    const unregisterUnauth = setUnauthorizedHandler(() => {
      if (isMounted) {
        setCurrentUser(null);
        setIsGuest(false);
        setSanctuaryAuthUser(null);
        try {
          sessionStorage.removeItem('aks_guest_mode');
          localStorage.removeItem('aks_guest_mode');
          localStorage.removeItem('aks_auth_user');
        } catch (_) {}
        if (onSessionExpired) {
          onSessionExpired();
        }
      }
    });

    return () => {
      isMounted = false;
      if (typeof unregisterUnauth === 'function') {
        unregisterUnauth();
      }
    };
  }, [onSessionExpired]);

  // Cross-tab synchronization listener
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === 'aks_auth_user') {
        if (!e.newValue) {
          // Logged out in another tab
          setCurrentUser(null);
          setIsGuest(false);
          setSanctuaryAuthUser(null);
        } else {
          // Logged in from another tab
          try {
            const user = JSON.parse(e.newValue);
            setCurrentUser(user);
            setIsGuest(false);
            setSanctuaryAuthUser(user);
            try {
              localStorage.removeItem('aks_guest_mode');
              sessionStorage.removeItem('aks_guest_mode');
            } catch (_) {}
          } catch (_) {}
        }
      } else if (e.key === 'aks_guest_mode') {
        // Only react to guest mode changes if user is not authenticated
        if (!currentUser && !localStorage.getItem('aks_auth_user')) {
          if (e.newValue === 'true') {
            try {
              sessionStorage.setItem('aks_guest_mode', 'true');
            } catch (_) {}
            setIsGuest(true);
          } else if (!e.newValue) {
            try {
              sessionStorage.removeItem('aks_guest_mode');
            } catch (_) {}
            setIsGuest(false);
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [currentUser]);

  const login = useCallback((user) => {
    try {
      sessionStorage.removeItem('aks_guest_mode');
      localStorage.removeItem('aks_guest_mode');
      localStorage.setItem('aks_auth_user', JSON.stringify(user));
    } catch (_) {}
    setCurrentUser(user);
    setIsGuest(false);
    setSanctuaryAuthUser(user);
    syncGlobalPreferencesFromServer().catch(() => {});
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (_) {}
    try {
      localStorage.removeItem('aks_auth_user');
      localStorage.removeItem('aks_guest_mode');
      sessionStorage.removeItem('aks_guest_mode');
    } catch (_) {}
    setSanctuaryAuthUser(null);
    setCurrentUser(null);
    setIsGuest(false);
  }, []);

  const exploreAsGuest = useCallback(() => {
    try {
      localStorage.setItem('aks_guest_mode', 'true');
      sessionStorage.setItem('aks_guest_mode', 'true');
    } catch (_) {}
    setCurrentUser(null);
    setSanctuaryAuthUser(null);
    setIsGuest(true);
  }, []);

  const value = useMemo(
    () => ({
      currentUser,
      isGuest,
      isAuthChecking,
      isAuthenticated: Boolean(currentUser),
      login,
      logout,
      exploreAsGuest,
    }),
    [currentUser, isGuest, isAuthChecking, login, logout, exploreAsGuest]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
