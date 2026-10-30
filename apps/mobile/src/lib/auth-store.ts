import type { TokenPair, User } from '@fim/shared';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { create } from 'zustand';

const SESSION_KEY = 'fim.session';
const BIOMETRIC_KEY = 'fim.biometric';

interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
}

type Status = 'loading' | 'signedOut' | 'locked' | 'signedIn';

interface AuthState {
  status: Status;
  session: Session | null;
  biometricEnabled: boolean;
  hydrate(): Promise<void>;
  signIn(session: Session): Promise<void>;
  setTokens(tokens: TokenPair): Promise<void>;
  signOut(): Promise<void>;
  unlock(): Promise<boolean>;
  setBiometric(enabled: boolean): Promise<boolean>;
}

/**
 * Session lives in SecureStore (Keychain / Keystore). With biometric unlock on, a cold start
 * lands on a lock screen until Face ID / fingerprint succeeds; the tokens never leave the store.
 */
export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  session: null,
  biometricEnabled: false,

  async hydrate() {
    const [raw, bio] = await Promise.all([
      SecureStore.getItemAsync(SESSION_KEY),
      SecureStore.getItemAsync(BIOMETRIC_KEY),
    ]);
    const session = raw ? (JSON.parse(raw) as Session) : null;
    const biometricEnabled = bio === '1';
    set({
      session,
      biometricEnabled,
      status: !session ? 'signedOut' : biometricEnabled ? 'locked' : 'signedIn',
    });
  },

  async signIn(session) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    set({ session, status: 'signedIn' });
  },

  async setTokens(tokens) {
    const current = get().session;
    if (!current) return;
    const session = {
      ...current,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
    set({ session });
  },

  async signOut() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    set({ session: null, status: 'signedOut' });
  },

  async unlock() {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Unlock Field Inspections',
      fallbackLabel: 'Use passcode',
    });
    if (result.success) set({ status: 'signedIn' });
    return result.success;
  },

  async setBiometric(enabled) {
    if (enabled) {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) return false;
      const confirm = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirm to enable quick unlock',
      });
      if (!confirm.success) return false;
    }
    await SecureStore.setItemAsync(BIOMETRIC_KEY, enabled ? '1' : '0');
    set({ biometricEnabled: enabled });
    return true;
  },
}));
