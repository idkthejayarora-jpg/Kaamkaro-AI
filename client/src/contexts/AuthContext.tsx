import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../lib/api';
import type { User } from '../types';

// localStorage keys for the stashed admin session when switched
const ADMIN_TOKEN_KEY = 'kk_admin_token';
const ADMIN_USER_KEY  = 'kk_admin_user';

interface AdminSession { token: string; user: User; }

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (name: string, phone: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (u: User) => void;
  isAdmin: boolean;
  // Account switcher
  isSwitched: boolean;
  originalAdmin: AdminSession | null;
  switchToStaff: (staffId: string) => Promise<void>;
  switchBack: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,  setUser]  = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Stashed real-admin session (non-null when currently switched to a staff account)
  const [originalAdmin, setOriginalAdmin] = useState<AdminSession | null>(null);

  const updateUser = useCallback((u: User) => {
    setUser(u);
    localStorage.setItem('kk_user', JSON.stringify(u));
  }, []);

  const logout = useCallback(() => {
    // If we're currently switched, just switch back to admin rather than fully logging out
    const savedAdminToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    const savedAdminUser  = localStorage.getItem(ADMIN_USER_KEY);
    if (savedAdminToken && savedAdminUser) {
      try {
        const adminUser: User = JSON.parse(savedAdminUser);
        localStorage.setItem('kk_token', savedAdminToken);
        localStorage.setItem('kk_user', savedAdminUser);
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        localStorage.removeItem(ADMIN_USER_KEY);
        setToken(savedAdminToken);
        setUser(adminUser);
        setOriginalAdmin(null);
        return;
      } catch { /* fall through to full logout */ }
    }
    localStorage.removeItem('kk_token');
    localStorage.removeItem('kk_user');
    localStorage.removeItem('kk_notif_read');
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
    setUser(null);
    setToken(null);
    setOriginalAdmin(null);
  }, []);

  // Restore session on mount — also restore any stashed admin session
  useEffect(() => {
    const storedToken = localStorage.getItem('kk_token');
    const storedUser  = localStorage.getItem('kk_user');

    // Restore stashed admin session (page was refreshed while switched)
    const storedAdminToken = localStorage.getItem(ADMIN_TOKEN_KEY);
    const storedAdminUser  = localStorage.getItem(ADMIN_USER_KEY);
    if (storedAdminToken && storedAdminUser) {
      try {
        setOriginalAdmin({ token: storedAdminToken, user: JSON.parse(storedAdminUser) });
      } catch { /* ignore corrupt cache */ }
    }

    if (!storedToken) { setLoading(false); return; }

    if (storedUser) {
      try { setToken(storedToken); setUser(JSON.parse(storedUser)); } catch {}
    }

    let authTimedOut = false;
    const authTimeout = setTimeout(() => {
      authTimedOut = true;
      localStorage.removeItem('kk_token');
      localStorage.removeItem('kk_user');
      setUser(null);
      setToken(null);
      setLoading(false);
    }, 8000);

    authAPI.me()
      .then(freshUser => {
        if (authTimedOut) return;
        clearTimeout(authTimeout);
        setUser(freshUser);
        setToken(storedToken);
        localStorage.setItem('kk_user', JSON.stringify(freshUser));
      })
      .catch(() => {
        if (authTimedOut) return;
        clearTimeout(authTimeout);
        localStorage.removeItem('kk_token');
        localStorage.removeItem('kk_user');
        setUser(null);
        setToken(null);
      })
      .finally(() => { if (!authTimedOut) setLoading(false); });
  }, []);

  const login = async (phone: string, password: string) => {
    const data = await authAPI.login(phone, password);
    localStorage.setItem('kk_token', data.token);
    localStorage.setItem('kk_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  const register = async (name: string, phone: string, password: string) => {
    const data = await authAPI.register(name, phone, password);
    localStorage.setItem('kk_token', data.token);
    localStorage.setItem('kk_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  // ── Account switcher ──────────────────────────────────────────────────────────

  const switchToStaff = useCallback(async (staffId: string) => {
    // Must be admin (real admin, not a switched session pretending to be admin)
    const currentToken = localStorage.getItem('kk_token');
    const currentUser  = user;
    if (!currentToken || !currentUser) return;

    const data = await authAPI.switchToStaff(staffId); // { token, user }

    // Stash current admin session
    const adminSession: AdminSession = {
      token: originalAdmin?.token || currentToken,   // preserve original if already switched
      user:  originalAdmin?.user  || currentUser,
    };
    localStorage.setItem(ADMIN_TOKEN_KEY, adminSession.token);
    localStorage.setItem(ADMIN_USER_KEY,  JSON.stringify(adminSession.user));

    // Activate staff session
    localStorage.setItem('kk_token', data.token);
    localStorage.setItem('kk_user',  JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
    setOriginalAdmin(adminSession);
  }, [user, originalAdmin]);

  const switchBack = useCallback(() => {
    if (!originalAdmin) return;
    localStorage.setItem('kk_token', originalAdmin.token);
    localStorage.setItem('kk_user',  JSON.stringify(originalAdmin.user));
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
    setToken(originalAdmin.token);
    setUser(originalAdmin.user);
    setOriginalAdmin(null);
  }, [originalAdmin]);

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, register, logout, updateUser,
      isAdmin: user?.role === 'admin',
      isSwitched: !!originalAdmin,
      originalAdmin,
      switchToStaff,
      switchBack,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
