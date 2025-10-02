import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { apiFetch } from '../api/client';
import type {
  AssignmentsDto,
  AuthLoginResponse,
  CategoryDto,
  EventSummary,
  NodeDto,
  UserRole,
  UserSummary,
} from '../api/types';

const STORAGE_KEY = 'draci-smycka-auth';
const EXPIRY_BUFFER_MS = 5_000;

interface AuthState {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  user: UserSummary;
  event: EventSummary;
  assignments: AssignmentsDto;
  categories: CategoryDto[];
  nodes: NodeDto[];
}

interface AuthContextValue {
  state: AuthState | null;
  isAuthenticated: boolean;
  login: (email: string, password: string, eventSlug?: string, deviceName?: string) => Promise<void>;
  logout: (allDevices?: boolean) => Promise<void>;
  ensureAccessToken: () => Promise<string>;
  fetchWithAuth: <T>(path: string, init?: RequestInit) => Promise<T>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function persistState(state: AuthState | null) {
  if (!state) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      ...state,
      // Prevent storing large arrays we can rehydrate later? Keep as-is for now.
    }),
  );
}

function mapLoginResponse(payload: AuthLoginResponse): AuthState {
  const now = Date.now();
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessTokenExpiresAt: now + payload.expiresIn * 1000,
    refreshTokenExpiresAt: now + payload.refreshExpiresIn * 1000,
    user: payload.user,
    event: payload.event,
    assignments: payload.assignments,
    categories: payload.categories,
    nodes: payload.nodes,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(raw) as AuthState;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }
      return parsed;
    } catch (error) {
      console.warn('Failed to restore auth state', error);
      return null;
    }
  });

  const refreshInFlight = useRef<Promise<AuthState> | null>(null);

  useEffect(() => {
    persistState(state);
  }, [state]);

  const logout = useCallback(
    async (allDevices = false) => {
      if (state) {
        try {
          await apiFetch('/auth/logout', {
            method: 'POST',
            body: JSON.stringify({ allDevices }),
          }, state.accessToken);
        } catch (error) {
          console.warn('Logout request failed', error);
        }
      }
      setState(null);
      persistState(null);
    },
    [state],
  );

  const performRefresh = useCallback(async (): Promise<AuthState> => {
    if (!state) {
      throw new Error('Not authenticated');
    }

    if (Date.now() > state.refreshTokenExpiresAt) {
      await logout();
      throw new Error('Session expired');
    }

    if (refreshInFlight.current) {
      return refreshInFlight.current;
    }

    const promise = apiFetch<AuthLoginResponse>(
      '/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify({ refreshToken: state.refreshToken }),
      },
    )
      .then((response) => {
        const nextState = mapLoginResponse(response);
        setState(nextState);
        return nextState;
      })
      .finally(() => {
        refreshInFlight.current = null;
      });

    refreshInFlight.current = promise;
    return promise;
  }, [state, logout]);

  const ensureAccessToken = useCallback(async () => {
    if (!state) {
      throw new Error('Not authenticated');
    }

    if (Date.now() < state.accessTokenExpiresAt - EXPIRY_BUFFER_MS) {
      return state.accessToken;
    }

    const refreshed = await performRefresh();
    return refreshed.accessToken;
  }, [state, performRefresh]);

  const login = useCallback(
    async (email: string, password: string, eventSlug?: string, deviceName?: string) => {
      const response = await apiFetch<AuthLoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, eventSlug, deviceName }),
      });

      const nextState = mapLoginResponse(response);
      setState(nextState);
    },
    [],
  );

  const fetchWithAuth = useCallback(
    async <T,>(path: string, init: RequestInit = {}) => {
      const token = await ensureAccessToken();
      return apiFetch<T>(path, init, token);
    },
    [ensureAccessToken],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      isAuthenticated: Boolean(state),
      login,
      logout,
      ensureAccessToken,
      fetchWithAuth,
    }),
    [state, login, logout, ensureAccessToken, fetchWithAuth],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function useUserRole(): UserRole | null {
  const { state } = useAuth();
  return state?.user.role ?? null;
}
