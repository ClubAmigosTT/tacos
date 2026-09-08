import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { login as loginRequest, me, register as registerRequest, type AuthUser } from '@/lib/api';

const TOKEN_KEY = 'tacos.session.token';
type AuthContextValue = {
  user?: AuthUser;
  token?: string;
  loading: boolean;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readToken() {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function writeToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<AuthUser>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      const saved = await readToken();
      if (!saved) { if (active) setLoading(false); return; }
      try {
        const result = await me(saved);
        if (active) { setToken(saved); setUser(result.user); }
      } catch { await writeToken(null); }
      if (active) setLoading(false);
    })();
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, token, loading,
    async signIn(input) { const result = await loginRequest(input); await writeToken(result.token); setToken(result.token); setUser(result.user); },
    async signUp(input) { const result = await registerRequest(input); await writeToken(result.token); setToken(result.token); setUser(result.user); },
    async signOut() { await writeToken(null); setToken(undefined); setUser(undefined); }
  }), [loading, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
