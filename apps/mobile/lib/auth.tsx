import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { ApiError, login as loginRequest, me, register as registerRequest, updateProfile as updateProfileRequest, type AuthUser } from '@/lib/api';

const TOKEN_KEY = 'tacos.session.token';
const USER_KEY = 'tacos.session.user';
type AuthContextValue = {
  user?: AuthUser;
  token?: string;
  loading: boolean;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: { email: string; password: string; displayName: string }) => Promise<void>;
  updateProfile: (input: { displayName: string }) => Promise<void>;
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

async function readUser(): Promise<AuthUser | undefined> {
  try {
    const raw = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(USER_KEY)
      : await SecureStore.getItemAsync(USER_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (typeof parsed.id !== 'string' || typeof parsed.email !== 'string' || typeof parsed.displayName !== 'string') return undefined;
    return { id: parsed.id, email: parsed.email, displayName: parsed.displayName, role: parsed.role, following: parsed.following };
  } catch {
    return undefined;
  }
}

async function writeUser(user: AuthUser | null) {
  const raw = user ? JSON.stringify(user) : null;
  if (Platform.OS === 'web') {
    if (raw) globalThis.localStorage?.setItem(USER_KEY, raw);
    else globalThis.localStorage?.removeItem(USER_KEY);
    return;
  }
  if (raw) await SecureStore.setItemAsync(USER_KEY, raw);
  else await SecureStore.deleteItemAsync(USER_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string>();
  const [user, setUser] = useState<AuthUser>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [saved, cachedUser] = await Promise.all([readToken(), readUser()]);
        if (!saved) return;
        if (active) { setToken(saved); if (cachedUser) setUser(cachedUser); }
        const result = await me(saved);
        await writeUser(result.user);
        if (active) { setToken(saved); setUser(result.user); }
      } catch (cause) {
        // A transient API outage must not erase a valid local identity. Only
        // an explicit auth rejection clears persisted session state.
        const unauthorized = cause instanceof ApiError && (cause.status === 401 || cause.status === 403);
        if (unauthorized) {
          try { await writeToken(null); await writeUser(null); } catch { /* storage can be unavailable */ }
          if (active) { setToken(undefined); setUser(undefined); }
        } else if (active) {
          // Without a cached profile, avoid rendering private screens with an
          // unresolved user while keeping the token for the next launch.
          setToken(undefined);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user, token, loading,
    async signIn(input) { const result = await loginRequest(input); await writeToken(result.token); await writeUser(result.user); setToken(result.token); setUser(result.user); },
    async signUp(input) { const result = await registerRequest(input); await writeToken(result.token); await writeUser(result.user); setToken(result.token); setUser(result.user); },
    async updateProfile(input) { if (!token) throw new Error('UNAUTHORIZED'); const result = await updateProfileRequest(input, token); await writeUser(result.user); setUser(result.user); },
    async signOut() { await writeToken(null); await writeUser(null); setToken(undefined); setUser(undefined); }
  }), [loading, token, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
}
