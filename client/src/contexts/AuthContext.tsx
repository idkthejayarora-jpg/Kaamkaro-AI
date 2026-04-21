import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { authAPI } from '../lib/api';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]   = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('kk_token');
    localStorage.removeItem('kk_user');
    localStorage.removeItem('kk_notif_read');
    setUser(null);
    setToken(null);
  }, []);

  // Restore session on mount — re-validate token with server
  useEffect(() => {
    const storedToken = localStorage.getItem('kk_token');
    const storedUser  = localStorage.getItem('kk_user');

    if (!storedToken) {
      setLoading(false);
      return;
    }

    // Optimistically restore from cache, then confirm with server
    if (storedUser) {
      try {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      } catch {}
    }

    authAPI.me()
      .then(freshUser => {
        setUser(freshUser);
        setToken(storedToken);
        localStorage.setItem('kk_user', JSON.stringify(freshUser));
      })
      .catch(() => {
        // Token is invalid/expired — clear everything
        localStorage.removeItem('kk_token');
        localStorage.removeItem('kk_user');
        setUser(null);
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (phone: string, password: string) => {
    const data = await authAPI.login(phone, password);
    localStorage.setItem('kk_token', data.token);
    localStorage.setItem('kk_user', JSON.stringify(data.user));
    setToken(data.token);
    setUser(data.user);
  };

  return (
    <AuthContext.Provider value={{
      user, token, loading, login, logout,
      isAdmin: user?.role === 'admin',
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
