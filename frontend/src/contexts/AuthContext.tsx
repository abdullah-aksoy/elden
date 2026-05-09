import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI, pushAPI } from '../services/api';
import { wsClient } from '../services/ws';
import { User } from '../types';
import { getExpoPushTokenSafe, getPlatformLabel } from '../lib/push';

interface AuthContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string, phone?: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const savedToken = await AsyncStorage.getItem('token');
      if (savedToken) {
        setToken(savedToken);
        const response = await authAPI.getMe();
        setUser(response.data);
        void wsClient.connect();
        void (async () => {
          const t = await getExpoPushTokenSafe();
          if (t) await pushAPI.register(t, getPlatformLabel());
        })();
      }
    } catch (error) {
      console.error('Load user error:', error);
      await AsyncStorage.removeItem('token');
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const response = await authAPI.login({ email, password });
    const { token: newToken, user: newUser } = response.data;
    setToken(newToken);
    setUser(newUser);
    void AsyncStorage.setItem('token', newToken);
    void wsClient.connect();
    void (async () => {
      const t = await getExpoPushTokenSafe();
      if (t) await pushAPI.register(t, getPlatformLabel());
    })();
  };

  /** Kayıt sonrası oturum açılmaz; kullanıcı giriş ekranından giriş yapar. */
  const register = async (email: string, password: string, name: string, phone?: string) => {
    await authAPI.register({ email, password, name, phone });
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    wsClient.disconnect();
    try {
      const t = await getExpoPushTokenSafe();
      if (t) await pushAPI.unregister(t);
      await AsyncStorage.removeItem('token');
    } catch {
      /* web / depolama hatasında bile oturum UI'da kapanmış olsun */
    }
  };

  const refreshUser = async () => {
    try {
      const response = await authAPI.getMe();
      setUser(response.data);
    } catch (error) {
      console.error('Refresh user error:', error);
    }
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
