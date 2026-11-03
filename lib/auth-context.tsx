import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  getMe,
  getToken,
  login as apiLogin,
  logout as apiLogout,
  logoutAllDevices as apiLogoutAllDevices,
  setUnauthorizedHandler,
  type MobileUser,
  type MobilePartner,
} from "./api";
import { resetChatUnread } from "./chat-unread";
import { readFeatures, type FeatureMap } from "./features";
import { clearDownloads } from "./files";
import { resetNoticeCache } from "./hearing-notice";
import { resetNotificationCount } from "./notification-count";
import { registerPushToken, resetBadge, revokePushToken } from "./push";

// Everything the app holds outside React state about the office that was
// signed in. The server already keeps each office to its own data; this
// is the handset's half — on a shared office phone, the next advocate to
// sign in (perhaps from another chambers) must not see a badge count, a
// WhatsApp template or a downloaded paper left over from the last one.
// Screens and their state unmount on sign-out by themselves.
function forgetOffice(): void {
  resetBadge();
  resetChatUnread();
  resetNotificationCount();
  resetNoticeCache();
  clearDownloads();
}

// Single source of truth for "who is signed in". Replaces the five-plus
// screens that each called getMe() on focus and stored the result in
// their own state. The provider runs one boot probe on mount, then every
// downstream screen reads the snapshot via useAuth().
//
// The global 401 interceptor lives here too: lib/api.ts notifies through
// setUnauthorizedHandler() whenever any authenticated request comes back
// 401 (throttled, real HTTP 401s only — never network failures), and the
// provider clears the dead token + flips to guest. The (home)/(admin)
// layout redirects handle navigation from there.
//
// What's intentionally NOT here:
//  - Token refresh — JWTs are long-lived and the server doesn't issue
//    refresh tokens today, so there's nothing to refresh against.

export type AuthStatus = "loading" | "guest" | "authenticated";

export type AuthState = {
  status: AuthStatus;
  user: MobileUser | null;
  partner: MobilePartner | null;
  // Partner-side office admin (chambers owner). Drives "+ New user",
  // delete-request approve/reject, etc.
  isPartnerAdmin: boolean;
  // Global Legaleezi admin. Drives access to the (admin) shell.
  isGlobalAdmin: boolean;
  // Modules this chambers can reach. Empty map = everything on, which is
  // also what an older backend (sending no map at all) means.
  features: FeatureMap;
  // Set when the boot probe failed (typically expired session). Cleared
  // on the next successful refresh().
  error: string | null;
};

type AuthContextValue = AuthState & {
  refresh: () => Promise<void>;
  login: (email: string, password: string) => Promise<MobileUser>;
  logout: () => Promise<void>;
  // Throws (and leaves everyone signed in) when the server can't do it.
  logoutAllDevices: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const GUEST_STATE: AuthState = {
  status: "guest",
  user: null,
  partner: null,
  isPartnerAdmin: false,
  isGlobalAdmin: false,
  features: {},
  error: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    ...GUEST_STATE,
    status: "loading",
  });

  // Guard against setState after unmount — the boot probe is async and
  // the provider can theoretically unmount in HMR or test scenarios.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // This device's push address, held so sign-out can hand it back. A
  // shared office phone that kept a signed-out advocate's token would
  // keep showing their chambers' notifications to whoever picked it up.
  const pushTokenRef = useRef<string | null>(null);
  // Which user we've registered for. Re-registering on every /me refresh
  // would be a wasted round-trip on each focus; re-registering when a
  // DIFFERENT advocate signs in on the same handset is the point.
  const pushForUserRef = useRef<string | null>(null);

  const applyMe = useCallback(
    (data: { user: MobileUser; partner: MobilePartner | null }) => {
      if (!aliveRef.current) return;
      // Only chambers users get pushes; the global admin shell has no
      // notifications of its own.
      if (
        data.user.userType !== "global_admin" &&
        pushForUserRef.current !== data.user.id
      ) {
        pushForUserRef.current = data.user.id;
        void registerPushToken().then((token) => {
          pushTokenRef.current = token;
        });
      }
      setState({
        status: "authenticated",
        user: data.user,
        partner: data.partner,
        isPartnerAdmin: data.user.userType === "partner_admin",
        isGlobalAdmin: data.user.userType === "global_admin",
        features: readFeatures(data.partner?.features),
        error: null,
      });
    },
    []
  );

  // Every way out of a session lands here — Sign out, Sign out of all
  // devices, a session that expired or was ended from another device —
  // so this is where the last office's leftovers are cleared.
  const applyGuest = useCallback((error: string | null) => {
    forgetOffice();
    // Forget who this handset was registered for, too: whoever signs in
    // next, even the same advocate again, registers afresh.
    pushTokenRef.current = null;
    pushForUserRef.current = null;
    if (!aliveRef.current) return;
    setState({ ...GUEST_STATE, error });
  }, []);

  const refresh = useCallback(async () => {
    try {
      // Skip the round-trip entirely on first launch — no token means no
      // session, no point asking the server. Saves a guaranteed 401.
      const token = await getToken();
      if (!token) {
        applyGuest(null);
        return;
      }
      const data = await getMe();
      applyMe(data);
    } catch (err) {
      // /me failed — treat as a dead session and clear the token so the
      // next launch doesn't keep retrying invalid creds. We swallow any
      // error from the logout call itself (network was probably the
      // original problem; secondary failures here are noise).
      await apiLogout().catch(() => undefined);
      applyGuest(err instanceof Error ? err.message : "Session expired.");
    }
  }, [applyMe, applyGuest]);

  // One probe on mount. Every downstream screen reads from the snapshot
  // instead of re-fetching — that's the whole point of the provider.
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Bridge from lib/api.ts: any authenticated request returning 401 means
  // the stored token is dead — drop it and become a guest in one place
  // instead of every screen handling it separately.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      apiLogout().catch(() => undefined);
      applyGuest("Your session expired. Please sign in again.");
    });
    return () => setUnauthorizedHandler(null);
  }, [applyGuest]);

  const login = useCallback(
    async (email: string, password: string) => {
      const user = await apiLogin(email, password);
      // apiLogin has already persisted the token; refresh() hydrates
      // partner + role flags from /me so guards downstream are accurate
      // immediately, not on next focus.
      await refresh();
      return user;
    },
    [refresh]
  );

  const logout = useCallback(async () => {
    // Hand the push address back BEFORE clearing the session token — the
    // revoke call is authenticated, and after apiLogout there's nothing
    // to authenticate it with.
    await revokePushToken(pushTokenRef.current);
    await apiLogout();
    applyGuest(null);
  }, [applyGuest]);

  const logoutAllDevices = useCallback(async () => {
    // Server first: if it can't end the other sessions, this one stays
    // too, rather than leaving the advocate signed out here and still
    // signed in on the phone they lost.
    await apiLogoutAllDevices();
    // No revoke call — this token is already dead, and the server dropped
    // this device's push address along with every other one.
    await apiLogout();
    applyGuest(null);
  }, [applyGuest]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, refresh, login, logout, logoutAllDevices }),
    [state, refresh, login, logout, logoutAllDevices]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error(
      "useAuth must be used inside <AuthProvider />. Wrap the root layout."
    );
  }
  return ctx;
}
