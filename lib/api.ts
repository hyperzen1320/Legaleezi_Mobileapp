import * as SecureStore from "expo-secure-store";
import { getApiBaseUrl } from "./config";

const TOKEN_KEY = "legaleasy_token";

export type MobileUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  userType: "global_admin" | "partner_admin" | "user";
  partnerId: string | null;
};

export type MobilePartner = {
  id: string;
  name: string;
  slug: string;
  plan: "trial" | "solo" | "office" | "chambers";
  subscription: {
    status: string;
    startDate: string;
    endDate: string;
  };
  // Which modules the global admin has left switched on. Absent on an
  // older backend, which reads as "everything on" — see lib/features.ts.
  features?: Record<string, boolean>;
};

export type AdminPartner = {
  id: string;
  name: string;
  slug: string;
  primaryEmail: string;
  primaryContactName: string;
  phone: string;
  city: string;
  state: string;
  plan: "trial" | "solo" | "office" | "chambers";
  status: string;
  startDate: string;
  endDate: string;
  createdAt: string;
};

export type AdminPartnerDetail = AdminPartner & {
  subscription: {
    status: string;
    startDate: string;
    endDate: string;
    seatLimit: number;
    matterLimit: number;
  };
  isDeleted: boolean;
  updatedAt: string;
};

export type AdminPlan = {
  key: "trial" | "solo" | "office" | "chambers";
  label: string;
  tagline: string;
  description: string;
  priceAmount: number;
  priceLabel: string;
  priceSuffix: string;
  billingCycle: "trial" | "monthly" | "yearly" | "bespoke";
  features: string[];
  seatLimit: number;
  matterLimit: number;
  isTrial: boolean;
  isPopular: boolean;
  showOnLanding: boolean;
  isActive: boolean;
  sortOrder: number;
  ctaLabel: string;
  updatedAt: string;
};

export type AdminActivity = {
  id: string;
  actorName: string;
  actorEmail: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type DashboardData = {
  stats: {
    totalPartners: number;
    activePartners: number;
    trialPartners: number;
    totalUsers: number;
  };
  recentPartners: Array<{
    id: string;
    name: string;
    slug: string;
    primaryEmail: string;
    plan: string;
    status: string;
    startDate: string;
    endDate: string;
    createdAt: string;
  }>;
  adminName: string;
};

/* ─────────── Token storage ─────────── */
export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

/* ─────────── Fetch wrapper ─────────── */
export class ApiError extends Error {
  status: number;
  // Full parsed JSON response body, when the server returned one. Some
  // endpoints (smart-delete) include structured codes on 4xx responses
  // that callers need to read; throwing away the body would force them
  // back to string-matching the message.
  body: Record<string, unknown> | null;
  constructor(
    message: string,
    status: number,
    body: Record<string, unknown> | null = null
  ) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/* ─────────── Global 401 handling ───────────
   Module-level subscribable bridge into React state (see the deferral
   note in auth-context.tsx). AuthProvider registers a handler that
   clears the token and flips the session to guest; the (home)/(admin)
   layout redirects do the navigation. Throttled so a burst of parallel
   requests failing together signs out once, not five times. Only real
   HTTP 401s fire it — network failures (status 0) never do. */
let unauthorizedHandler: (() => void) | null = null;
let lastUnauthorizedAt = 0;
const UNAUTHORIZED_THROTTLE_MS = 5_000;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function notifyUnauthorized(): void {
  const now = Date.now();
  if (now - lastUnauthorizedAt < UNAUTHORIZED_THROTTLE_MS) return;
  lastUnauthorizedAt = now;
  unauthorizedHandler?.();
}

/** Authorization header for callers that fetch outside api()/apiUpload()
 *  — the binary download paths in lib/files.ts. */
export async function getAuthHeader(): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBaseUrl();
  const token = await getToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    ...((init.headers as Record<string, string> | undefined) ?? {}),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      `Couldn't reach the server at ${base}. Check your network.`,
      0
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }

  if (!res.ok) {
    const body =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null;
    const msg =
      (body?.error as string | undefined) ??
      `Request failed (${res.status})`;
    // A 401 from anything but the login attempt itself means the stored
    // token is dead — tell the auth provider so the app signs out once.
    if (res.status === 401 && !path.startsWith("/api/mobile/login")) {
      notifyUnauthorized();
    }
    throw new ApiError(msg, res.status, body);
  }

  return data as T;
}

/**
 * Multipart upload variant of api(). Deliberately a separate function,
 * not an option flag: it must NEVER set Content-Type. React Native's
 * fetch generates the `multipart/form-data; boundary=…` header from the
 * FormData itself — overriding it makes Next's request.formData() reject
 * the body. FormData file parts are `{ uri, name, type }` objects.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  const base = getApiBaseUrl();
  const token = await getToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      body: form,
      headers,
    });
  } catch {
    throw new ApiError(
      `Couldn't reach the server at ${base}. Check your network.`,
      0
    );
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* not JSON */
  }

  if (!res.ok) {
    const body =
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null;
    const msg =
      (body?.error as string | undefined) ?? `Upload failed (${res.status})`;
    if (res.status === 401) notifyUnauthorized();
    throw new ApiError(msg, res.status, body);
  }

  return data as T;
}

/* ─────────── Auth flows ─────────── */
export async function login(email: string, password: string): Promise<MobileUser> {
  const data = await api<{ token: string; user: MobileUser }>(
    "/api/mobile/login",
    { method: "POST", body: JSON.stringify({ email, password }) }
  );
  await setToken(data.token);
  return data.user;
}

export async function getMe(): Promise<{ user: MobileUser; partner: MobilePartner | null }> {
  return api<{ user: MobileUser; partner: MobilePartner | null }>(
    "/api/mobile/me",
    { method: "GET" }
  );
}

export async function logout(): Promise<void> {
  await clearToken();
}

/**
 * @deprecated Superseded by signupStart/signupVerify. The Sign Up screen
 * now opens a chambers directly on the trial instead of queueing a
 * request nobody reads (nothing in the global admin console surfaces the
 * AccessRequest collection). Kept only because the endpoint still exists
 * server-side; delete both together.
 */
export async function requestAccess(payload: {
  name: string;
  chambers: string;
  email: string;
  phone: string;
  message?: string;
}): Promise<{ ok: true; id: string }> {
  return api<{ ok: true; id: string }>("/api/mobile/access-requests", {
    method: "POST",
    body: JSON.stringify({ ...payload, source: "mobile" }),
  });
}

// Raise a support ticket from More → Support. The reporter's identity
// (name / email) is resolved server-side from the session, so we only send
// the subject, category, message and an optional phone override. It lands
// in the Global-Admin support inbox.
export async function partnerCreateSupportTicket(payload: {
  subject?: string;
  category?: string;
  message: string;
  phone?: string;
}): Promise<{ ok: true; id: string }> {
  return api<{ ok: true; id: string }>("/api/mobile/support", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─────────── Tutorials (global-admin-managed media) ─────────── */
export type TutorialMedia = {
  id: string;
  title: string;
  description: string;
  kind: "video" | "image" | "pdf";
  size: number;
  contentType: string;
};

export async function partnerListTutorials(): Promise<{
  tutorials: TutorialMedia[];
}> {
  return api<{ tutorials: TutorialMedia[] }>("/api/mobile/tutorials");
}

// Absolute URL of a tutorial's binary — fed to the video player / <Image>
// with an Authorization header (see getAuthHeader). The endpoint supports
// HTTP range requests so the player can seek.
export function tutorialFileUrl(id: string): string {
  return `${getApiBaseUrl()}/api/mobile/tutorials/${id}/file`;
}

/* ─────────── Sign up (emailed one-time code) ───────────
   Two unauthenticated calls, shared verbatim with the web app.

   `start` writes NOTHING to Partner or User — the chambers details ride
   along inside the one-time-code record and are only spent once the
   address proves itself, so an abandoned sign-up leaves nothing behind
   in the global admin's list. `verify` is what creates the chambers on
   the trial plan. */

export async function signupStart(payload: {
  chambersName: string;
  contactName: string;
  phone: string;
  email: string;
  password: string;
}): Promise<{ ok: true; retryAfterSeconds?: number }> {
  return api("/api/account/signup/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function signupVerify(
  email: string,
  code: string
): Promise<{
  ok: true;
  partner: { id: string; name: string; slug: string };
  trial: { days: number; endsAt: string; seatLimit: number };
}> {
  return api("/api/account/signup/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

/* ─────────── Password reset (emailed one-time code) ───────────
   Three unauthenticated calls, shared verbatim with the web app:

     start   mails a six-digit code to a registered address
     verify  exchanges a correct code for a short-lived signed ticket
     reset   spends the ticket and writes the new password

   `start` deliberately answers the same way whether or not the address
   has an account — the server won't confirm who banks with it. */

export async function passwordResetStart(
  email: string
): Promise<{ ok: true; retryAfterSeconds?: number; throttled?: boolean }> {
  return api("/api/account/password/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function passwordResetVerify(
  email: string,
  code: string
): Promise<{ ok: true; ticket: string }> {
  return api("/api/account/password/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}

export async function passwordResetComplete(
  ticket: string,
  password: string
): Promise<{ ok: true }> {
  return api("/api/account/password/reset", {
    method: "POST",
    body: JSON.stringify({ ticket, password }),
  });
}

/* ─────────── Admin endpoints (for global_admin) ─────────── */
export async function adminDashboard(): Promise<DashboardData> {
  return api<DashboardData>("/api/admin/dashboard", { method: "GET" });
}

export async function adminListPartners(): Promise<{ partners: AdminPartner[] }> {
  return api<{ partners: AdminPartner[] }>("/api/admin/partners", {
    method: "GET",
  });
}

export async function adminGetPartner(id: string): Promise<{
  partner: AdminPartnerDetail;
  partnerAdmin: { id: string; email: string } | null;
}> {
  return api<{
    partner: AdminPartnerDetail;
    partnerAdmin: { id: string; email: string } | null;
  }>(`/api/admin/partners/${id}`, { method: "GET" });
}

export async function adminCreatePartner(payload: {
  name: string;
  primaryEmail: string;
  primaryContactName: string;
  phone: string;
  city?: string;
  state?: string;
  plan: "trial" | "solo" | "office" | "chambers";
  trialDays: number;
  password: string;
}): Promise<{ ok: true; partner: { id: string; slug: string; name: string; primaryEmail: string } }> {
  return api("/api/admin/partners", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminUpdatePartner(
  id: string,
  payload: Partial<{
    name: string;
    primaryContactName: string;
    phone: string;
    city: string;
    state: string;
    plan: "trial" | "solo" | "office" | "chambers";
    subscriptionStatus:
      | "trial"
      | "active"
      | "past_due"
      | "cancelled"
      | "suspended";
    extendTrialDays: number;
  }>
): Promise<{ ok: true; changes: string[] }> {
  return api(`/api/admin/partners/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function adminDeletePartner(id: string): Promise<{ ok: true }> {
  return api(`/api/admin/partners/${id}`, { method: "DELETE" });
}

export async function adminResetPartnerPassword(
  id: string,
  password: string
): Promise<{ ok: true }> {
  return api(`/api/admin/partners/${id}/password`, {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

/* ─────────── Partner-side endpoints ─────────── */

export type PartnerCaseHearing = {
  date: string;
  status: string;
  outcome: string;
  nextDate: string | null;
};

export type PartnerCase = {
  id: string;
  caseNo: string;
  fileNo: string;
  cnr: string;
  title: string;
  clientName: string;
  clientPhone: string;
  clientWhatsapp: string;
  clientAddress: string;
  oppositeParty: string;
  appearingFor: string;
  oppositeAdvocate: string;
  iaNumbers: string;
  courtName: string;
  courtHall: string;
  courtPlace: string;
  status: string;
  nextHearingDate: string | null;
  lastHearingDate: string | null;
  hearings: PartnerCaseHearing[];
  disposedAt: string | null;
  disposalDate: string | null;
  disposalRemarks: string;
  caStatus: string;
  receivedByClient: boolean;
  createdAt: string;
  updatedAt: string;
  // Present on list rows (the detail serializer omits some of these).
  courtId?: string | null;
  courtNumber?: string;
  advocateId?: string | null;
  advocateName?: string;
};

export type PartnerCaseInput = {
  caseNo: string;
  fileNo?: string;
  cnr?: string;
  clientName?: string;
  clientPhone?: string;
  clientWhatsapp?: string;
  clientAddress?: string;
  oppositeParty?: string;
  appearingFor?: string;
  oppositeAdvocate?: string;
  iaNumbers?: string;
  courtName?: string;
  courtHall?: string;
  courtPlace?: string;
  status?: string;
  nextHearingDate?: string | null;
  lastHearingDate?: string | null;
  // Disposal record — persisted whenever the status is "Disposed" (an
  // admin-only transition, server-enforced). disposalDate is the recorded
  // order date (defaults to today server-side); caStatus tracks the
  // certified-copy application (Applied / Ready / Delivered).
  disposalRemarks?: string;
  disposalDate?: string | null;
  caStatus?: string;
  receivedByClient?: boolean;
};

export type PartnerDashboardData = {
  stats: {
    todayHearings: number;
    tomorrowHearings: number;
    pendingDates: number;
    caseVault: number;
  };
  todaysBoard: Array<{
    id: string;
    caseNo: string;
    status: string;
    clientName: string;
    courtName: string;
    courtPlace: string;
    nextHearingDate: string | null;
  }>;
};

export async function partnerDashboard(): Promise<PartnerDashboardData> {
  return api<PartnerDashboardData>("/api/app/dashboard", { method: "GET" });
}

/** Server-side Case Vault filters — same param names as the web toolbar
 *  and the export endpoint (case-filter.ts). */
// How the vault is ordered. Mirrors CaseSort in the API's lib/case-sort.
// "recent" is the server default — the matter filed last, from either
// app, is the first row.
export type CaseSort = "recent" | "hearing" | "caseNo";

export const CASE_SORT_OPTIONS: { key: CaseSort; label: string; hint: string }[] =
  [
    {
      key: "recent",
      label: "Recently added",
      hint: "Newest matter first — including one just filed on the web.",
    },
    {
      key: "hearing",
      label: "Next hearing",
      hint: "Soonest date first, undated matters leading.",
    },
    { key: "caseNo", label: "Case number", hint: "Plain alphabetical." },
  ];

export type CaseListFilters = {
  courtId?: string;
  courtPlace?: string;
  advocateId?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string; // YYYY-MM-DD
  search?: string;
  sort?: CaseSort;
};

export async function partnerListCases(opts?: {
  filters?: CaseListFilters;
  page?: number;
  limit?: number;
}): Promise<{
  cases: PartnerCase[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}> {
  const qs = new URLSearchParams();
  if (opts?.filters) {
    for (const [k, v] of Object.entries(opts.filters)) {
      if (typeof v === "string" && v.trim()) qs.set(k, v.trim());
    }
  }
  if (opts?.page) qs.set("page", String(opts.page));
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const suffix = qs.toString();
  return api(`/api/app/cases${suffix ? `?${suffix}` : ""}`, {
    method: "GET",
  });
}

export async function partnerCreateCase(
  payload: PartnerCaseInput
): Promise<{ ok: true; id: string }> {
  return api("/api/app/cases", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerGetCase(
  id: string
): Promise<{ case: PartnerCase; officeName: string }> {
  return api(`/api/app/cases/${id}`, { method: "GET" });
}

export async function partnerUpdateCase(
  id: string,
  patch: Partial<PartnerCaseInput>
): Promise<{ ok: true; case: PartnerCase }> {
  return api(`/api/app/cases/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function partnerDeleteCase(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/cases/${id}`, { method: "DELETE" });
}

// Permanent bulk delete — office-admin only (server-enforced). Pass an
// explicit id list, or { all: true } with the current filters to delete
// every active matter matching them (the "select all N matching" path that
// spans pages). A deleted matter frees its CNR for re-use, exactly like a
// single delete.
export async function partnerBulkDeleteCases(
  payload: { ids: string[] } | { all: true; filters?: CaseListFilters }
): Promise<{ ok: true; deleted: number }> {
  return api("/api/app/cases/bulk-delete", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Bulk restore (reopen) for the Disposed archive — office-admin only
// (server-enforced). Each id is brought back into the live vault with status
// "Filed"; disposed matters keep their CNR locked, so restoring never collides.
export async function partnerBulkRestoreCases(
  payload: { ids: string[] }
): Promise<{ ok: true; restored: number; skipped: number }> {
  return api("/api/app/cases/bulk-restore", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Office WhatsApp notice template ─── */

// Any user can read the office's notice template (their WhatsApp button uses
// it); only the partner admin can PATCH it.
export async function partnerGetNoticeTemplate(): Promise<{ template: string }> {
  return api("/api/app/office/notice-template", { method: "GET" });
}

export async function partnerSaveNoticeTemplate(
  template: string
): Promise<{ ok: true; template: string }> {
  return api("/api/app/office/notice-template", {
    method: "PATCH",
    body: JSON.stringify({ template }),
  });
}

/* ─── Clients ─── */

export type PartnerClient = {
  id: string;
  name: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  caseCount: number;
};

export type PartnerClientInput = {
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  address?: string;
};

export async function partnerListClients(): Promise<{
  clients: PartnerClient[];
}> {
  return api<{ clients: PartnerClient[] }>("/api/app/clients", {
    method: "GET",
  });
}

export async function partnerCreateClient(
  payload: PartnerClientInput
): Promise<{ ok: true; id: string }> {
  return api("/api/app/clients", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Users (office team / RBAC) ─── */

export type PartnerStaffUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  userType: string;
  role: string;
  phone: string;
  designation: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  isYou?: boolean;
};

export type PartnerStaffUserInput = {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
  role?: string;
  designation?: string;
  phone?: string;
};

export type PartnerStaffUserPatch = {
  firstName?: string;
  lastName?: string;
  role?: string;
  designation?: string;
  phone?: string;
  active?: boolean;
  password?: string;
};

export async function partnerListUsers(): Promise<{
  users: PartnerStaffUser[];
  currentUserId: string;
}> {
  return api<{ users: PartnerStaffUser[]; currentUserId: string }>(
    "/api/app/users",
    { method: "GET" }
  );
}

export async function partnerCreateUser(
  payload: PartnerStaffUserInput
): Promise<{ ok: true; user: PartnerStaffUser }> {
  return api("/api/app/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerUpdateUser(
  id: string,
  payload: PartnerStaffUserPatch
): Promise<{ ok: true; user: PartnerStaffUser }> {
  return api(`/api/app/users/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteUser(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/users/${id}`, { method: "DELETE" });
}

/* ─── Profile ─── */

export type PartnerProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  name: string;
  phone: string;
  state: string;
  country: string;
  officeAddress: string;
  barEnrolmentNo: string;
  designation: string;
  profilePhoto: string;
};

export type PartnerProfileInput = {
  name?: string;
  phone?: string;
  state?: string;
  country?: string;
  officeAddress?: string;
  barEnrolmentNo?: string;
  designation?: string;
  profilePhoto?: string;
};

export async function partnerGetProfile(): Promise<{
  profile: PartnerProfile;
}> {
  return api<{ profile: PartnerProfile }>("/api/app/profile", {
    method: "GET",
  });
}

export async function partnerUpdateProfile(
  payload: PartnerProfileInput
): Promise<{ ok: true; profile: PartnerProfile }> {
  return api("/api/app/profile", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/* ─── Prompt templates ─── */

export type PartnerPrompt = {
  id: string;
  title: string;
  body: string;
  category: string;
  isSeeded: boolean;
  updatedAt?: string;
};

export type PartnerPromptInput = {
  title: string;
  body?: string;
  category?: string;
};

export async function partnerListPrompts(): Promise<{
  prompts: PartnerPrompt[];
}> {
  return api<{ prompts: PartnerPrompt[] }>("/api/app/prompts", {
    method: "GET",
  });
}

export async function partnerCreatePrompt(
  payload: PartnerPromptInput
): Promise<{ ok: true; prompt: PartnerPrompt }> {
  return api("/api/app/prompts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerUpdatePrompt(
  id: string,
  payload: Partial<PartnerPromptInput>
): Promise<{ ok: true; prompt: PartnerPrompt }> {
  return api(`/api/app/prompts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeletePrompt(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/prompts/${id}`, { method: "DELETE" });
}

/* ─── Workflow boards ─── */

// Mirrors the server enum (legaleasy/src/lib/board-defaults.ts). The last
// three were added for offices that had more boards than tellable-apart
// tiles — a cool grey, a muted olive and a violet.
export type BoardColor =
  | "forest"
  | "copper"
  | "sea"
  | "terracotta"
  | "ochre"
  | "plum"
  | "ink"
  | "slate"
  | "olive"
  | "indigo";

export type PartnerBoard = {
  id: string;
  title: string;
  description: string;
  color: BoardColor;
  isSeeded: boolean;
  cardCount: number;
  updatedAt: string;
  createdAt: string;
};

export type PartnerBoardInput = {
  title: string;
  description?: string;
  color?: BoardColor;
};

export async function partnerListBoards(): Promise<{
  boards: PartnerBoard[];
}> {
  return api<{ boards: PartnerBoard[] }>("/api/app/boards", {
    method: "GET",
  });
}

export async function partnerCreateBoard(
  payload: PartnerBoardInput
): Promise<{ ok: true; board: PartnerBoard }> {
  return api("/api/app/boards", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Board state — lists, tasks, edges, members ───────────────────────
   These types mirror the web app's `/api/app/boards/[id]/full` response
   one-for-one. Keep them in sync if the web payload ever changes. */

export type BoardMember = { id: string; name: string; role: string };

export type CanvasList = {
  id: string;
  title: string;
  sortOrder: number;
  position: { x: number; y: number };
  width: number;
  color: string | null;
};

export type CanvasEdge = {
  id: string;
  sourceListId: string;
  targetListId: string;
  sourceHandle: string;
  targetHandle: string;
  label: string;
  color: string | null;
  style: "solid" | "dashed";
};

export type CardChecklistSummary = {
  totalChecklists: number;
  totalItems: number;
  doneItems: number;
};

export type CardPriority = "low" | "medium" | "high" | null;

export type PreviewTask = {
  id: string;
  listId: string;
  title: string;
  description: string;
  sortOrder: number;
  assignee: { id: string; name: string; role: string } | null;
  dueDate: string | null;
  priority: CardPriority;
  checklistSummary: CardChecklistSummary;
  hasDescription: boolean;
  updatedAt: string;
};

export type BoardFullResponse = {
  board: {
    id: string;
    title: string;
    description: string;
    color: BoardColor;
  };
  lists: CanvasList[];
  edges: CanvasEdge[];
  tasks: PreviewTask[];
  members: BoardMember[];
  role: string;
  currentUserId: string;
};

export async function partnerGetBoardFull(
  id: string
): Promise<BoardFullResponse> {
  return api<BoardFullResponse>(`/api/app/boards/${id}/full`, {
    method: "GET",
  });
}

/* ─── Lists CRUD ─────────────────────────────────────────────────────── */

export async function partnerCreateList(
  boardId: string,
  payload: { title: string }
): Promise<{
  ok: true;
  list: { id: string; title: string; sortOrder: number };
}> {
  return api(`/api/app/boards/${boardId}/lists`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerUpdateList(
  listId: string,
  payload: { title?: string; color?: string | null }
): Promise<{
  ok: true;
  list: { id: string; title: string; sortOrder: number };
}> {
  return api(`/api/app/lists/${listId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export type DeleteRequestTargetType =
  | "list"
  | "task"
  | "board"
  | "case"
  | "client"
  | "court"
  | "prompt"
  | "case_document";

export type DeleteRequestRequiredError = {
  error: string;
  code: "delete_request_required";
  targetType: DeleteRequestTargetType;
  targetId: string;
  targetName: string;
};

/**
 * Reads a thrown ApiError to see if the server is asking the user to file
 * a delete request instead of direct-deleting. Returns the structured
 * payload when that's the case, null otherwise.
 */
export function deleteRequestRequired(
  err: unknown
): DeleteRequestRequiredError | null {
  if (!(err instanceof ApiError)) return null;
  if (err.status !== 403) return null;
  const body = err.body;
  if (!body || body.code !== "delete_request_required") return null;
  return body as unknown as DeleteRequestRequiredError;
}

export async function partnerDeleteList(
  listId: string
): Promise<{ ok: true; cardsRemoved?: number }> {
  return api(`/api/app/lists/${listId}`, { method: "DELETE" });
}

/**
 * Reorder the board's columns. Pass the FULL ordered array of list ids;
 * the server bulk-writes each list's sortOrder to its index in the array.
 * Layout-only — the server records no activity for it.
 */
export async function partnerReorderLists(
  boardId: string,
  listIds: string[]
): Promise<{ ok: true }> {
  return api(`/api/app/boards/${boardId}/reorder`, {
    method: "POST",
    body: JSON.stringify({ listIds }),
  });
}

/* ─── Tasks (cards) CRUD ─────────────────────────────────────────────── */

export type TaskFullChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  sortOrder: number;
};

export type TaskFullChecklist = {
  id: string;
  title: string;
  sortOrder: number;
  items: TaskFullChecklistItem[];
};

export type SerializedTaskFull = {
  id: string;
  listId: string;
  title: string;
  description: string;
  sortOrder: number;
  assignee: { id: string; name: string; role: string } | null;
  dueDate: string | null;
  priority: CardPriority;
  checklistSummary: CardChecklistSummary;
  hasDescription: boolean;
  updatedAt: string;
  checklists: TaskFullChecklist[];
};

export type TaskFullResponse = {
  task: SerializedTaskFull;
  activity: Array<{
    id: string;
    action: string;
    actorName: string;
    message: string;
    createdAt: string;
    metadata: Record<string, unknown>;
  }>;
};

export async function partnerCreateTask(
  boardId: string,
  payload: { listId: string; title: string }
): Promise<{ ok: true; task: PreviewTask }> {
  return api(`/api/app/boards/${boardId}/tasks`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerGetTask(taskId: string): Promise<TaskFullResponse> {
  return api<TaskFullResponse>(`/api/app/tasks/${taskId}`, { method: "GET" });
}

export async function partnerUpdateTask(
  taskId: string,
  payload: {
    title?: string;
    description?: string;
    assignedToUserId?: string | null;
    dueDate?: string | null;
    priority?: CardPriority;
  }
): Promise<{ ok: true }> {
  return api(`/api/app/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteTask(
  taskId: string
): Promise<{ ok: true }> {
  return api(`/api/app/tasks/${taskId}`, { method: "DELETE" });
}

export async function partnerMoveTask(
  taskId: string,
  payload: { toListId: string; toIndex: number }
): Promise<{ ok: true; listId: string; sortOrder: number }> {
  return api(`/api/app/tasks/${taskId}/move`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Checklists ─────────────────────────────────────────────────────── */

export async function partnerAddChecklist(
  taskId: string,
  payload: { title: string }
): Promise<{ ok: true; checklist: TaskFullChecklist }> {
  return api(`/api/app/tasks/${taskId}/checklists`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerUpdateChecklist(
  taskId: string,
  clId: string,
  payload: { title: string }
): Promise<{ ok: true }> {
  return api(`/api/app/tasks/${taskId}/checklists/${clId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteChecklist(
  taskId: string,
  clId: string
): Promise<{ ok: true }> {
  return api(`/api/app/tasks/${taskId}/checklists/${clId}`, {
    method: "DELETE",
  });
}

export async function partnerAddChecklistItem(
  taskId: string,
  clId: string,
  payload: { text: string }
): Promise<{ ok: true; item: TaskFullChecklistItem }> {
  return api(`/api/app/tasks/${taskId}/checklists/${clId}/items`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerUpdateChecklistItem(
  taskId: string,
  clId: string,
  itemId: string,
  payload: { text?: string; done?: boolean }
): Promise<{ ok: true }> {
  return api(
    `/api/app/tasks/${taskId}/checklists/${clId}/items/${itemId}`,
    { method: "PATCH", body: JSON.stringify(payload) }
  );
}

export async function partnerDeleteChecklistItem(
  taskId: string,
  clId: string,
  itemId: string
): Promise<{ ok: true }> {
  return api(
    `/api/app/tasks/${taskId}/checklists/${clId}/items/${itemId}`,
    { method: "DELETE" }
  );
}

/* ─── Activity, live feed, presence, delete requests ───────────────── */

export type LiveActivityRow = {
  id: string;
  actorUserId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  message: string;
  metadata: Record<string, unknown>;
  boardId: string | null;
  createdAt: string;
};

export type LiveFeedResponse = {
  events: LiveActivityRow[];
  latestId: string | null;
  serverTime: number;
  truncated?: boolean;
};

export async function partnerLiveFeed(opts: {
  since?: string | null;
  boardId?: string | null;
  limit?: number;
}): Promise<LiveFeedResponse> {
  const qs = new URLSearchParams();
  if (opts.since) qs.set("since", opts.since);
  if (opts.boardId) qs.set("board", opts.boardId);
  if (opts.limit) qs.set("limit", String(opts.limit));
  return api<LiveFeedResponse>(
    `/api/app/activity/live?${qs.toString()}`,
    { method: "GET" }
  );
}

export type ActivityHistoryRow = {
  id: string;
  actorUserId: string | null;
  actorName: string;
  actorEmail: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  targetName: string;
  message: string;
  metadata: Record<string, unknown>;
  boardId: string | null;
  createdAt: string;
};

export async function partnerActivityHistory(opts: {
  boardId?: string;
  limit?: number;
  before?: string;
  /** ISO date (yyyy-mm-dd), inclusive lower bound. */
  from?: string;
  /** ISO date (yyyy-mm-dd), inclusive upper bound (end of that day). */
  to?: string;
  /** Narrow to one actor's entries. */
  actor?: string;
  /** e.g. "case." / "task." — matches a family of actions. */
  actionPrefix?: string;
}): Promise<{
  activity: ActivityHistoryRow[];
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const qs = new URLSearchParams();
  if (opts.boardId) qs.set("board", opts.boardId);
  qs.set("limit", String(opts.limit ?? 50));
  if (opts.before) qs.set("before", opts.before);
  // The web route has always accepted these (api/app/activity/route.ts);
  // the app simply never sent them, which is why it looked like the feed
  // only went back a day — it was one page of 50, not a date limit.
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  if (opts.actor) qs.set("actor", opts.actor);
  if (opts.actionPrefix) qs.set("actionPrefix", opts.actionPrefix);
  return api(`/api/app/activity?${qs.toString()}`, { method: "GET" });
}

export type PartnerPresenceUser = {
  userId: string;
  name: string;
  role: string;
  designation: string;
  lastBeat: string;
  isYou: boolean;
};

export async function partnerHeartbeat(
  boardId: string
): Promise<{ active: PartnerPresenceUser[] }> {
  return api(`/api/app/boards/${boardId}/heartbeat`, {
    method: "POST",
    body: "{}",
  });
}

export type DeleteRequestRow = {
  id: string;
  requesterName: string;
  targetType: string;
  targetId: string;
  targetName: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "obsolete";
  createdAt: string;
  reviewedByName?: string;
  reviewerNote?: string;
};

export async function partnerListDeleteRequests(opts: {
  status?: "pending" | "approved" | "rejected" | "obsolete";
  boardId?: string;
  limit?: number;
}): Promise<{ requests: DeleteRequestRow[] }> {
  const qs = new URLSearchParams();
  if (opts.status) qs.set("status", opts.status);
  if (opts.boardId) qs.set("boardId", opts.boardId);
  if (opts.limit) qs.set("limit", String(opts.limit));
  return api(`/api/app/delete-requests?${qs.toString()}`, { method: "GET" });
}

export async function partnerCreateDeleteRequest(payload: {
  targetType: DeleteRequestTargetType;
  targetId: string;
  reason: string;
}): Promise<{ ok: true; id: string }> {
  return api(`/api/app/delete-requests`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerApproveDeleteRequest(
  id: string,
  note?: string
): Promise<{ ok: true }> {
  return api(`/api/app/delete-requests/${id}/approve`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? "" }),
  });
}

export async function partnerRejectDeleteRequest(
  id: string,
  note?: string
): Promise<{ ok: true }> {
  return api(`/api/app/delete-requests/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ note: note ?? "" }),
  });
}

export async function partnerDeleteRequestCount(opts?: {
  boardId?: string;
}): Promise<{ count: number }> {
  const qs = new URLSearchParams();
  if (opts?.boardId) qs.set("boardId", opts.boardId);
  const suffix = qs.toString();
  return api(
    `/api/app/delete-requests/count${suffix ? `?${suffix}` : ""}`,
    { method: "GET" }
  );
}

/* ─── Courts ─── */

export type PartnerCourt = {
  id: string;
  name: string;
  number: string;
  place: string;
  caseCount: number;
};

export type PartnerCourtInput = {
  name: string;
  number?: string;
  place?: string;
};

export async function partnerListCourts(): Promise<{
  courts: PartnerCourt[];
}> {
  return api<{ courts: PartnerCourt[] }>("/api/app/courts", { method: "GET" });
}

export async function partnerCreateCourt(
  payload: PartnerCourtInput
): Promise<{ ok: true; court: PartnerCourt }> {
  return api("/api/app/courts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Hearing Track ─── */

export type HearingBucket = "today" | "tomorrow" | "pending";

export type PartnerHearingItem = {
  id: string;
  caseNo: string;
  fileNo: string;
  cnr: string;
  clientName: string;
  clientPhone: string;
  clientWhatsapp: string;
  oppositeParty: string;
  courtName: string;
  courtPlace: string;
  status: string;
  nextHearingDate: string | null;
  lastHearingDate: string | null;
};

export type PartnerHearingsResponse = {
  bucket: HearingBucket;
  items: PartnerHearingItem[];
  counts: { today: number; tomorrow: number; pending: number };
  officeName: string;
};

export async function partnerListHearings(
  bucket: HearingBucket
): Promise<PartnerHearingsResponse> {
  return api<PartnerHearingsResponse>(
    `/api/app/hearings?bucket=${bucket}`,
    { method: "GET" }
  );
}

/* ─────────── Activity endpoint (admin) ─────────── */

export async function adminListActivity(
  filter: "all" | "created" | "updated" | "password" | "danger" | "plan" = "all",
  limit = 50
): Promise<{ activities: AdminActivity[]; total: number }> {
  const params = new URLSearchParams({ filter, limit: String(limit) });
  return api(`/api/admin/activity?${params.toString()}`, { method: "GET" });
}

export async function adminListPlans(): Promise<{ plans: AdminPlan[] }> {
  return api<{ plans: AdminPlan[] }>("/api/admin/subscriptions", {
    method: "GET",
  });
}

export async function adminGetPlan(
  key: string
): Promise<{ plan: AdminPlan }> {
  return api<{ plan: AdminPlan }>(`/api/admin/subscriptions/${key}`, {
    method: "GET",
  });
}

export async function adminUpdatePlan(
  key: string,
  payload: Partial<{
    label: string;
    tagline: string;
    description: string;
    priceAmount: number;
    priceLabel: string;
    priceSuffix: string;
    billingCycle: "trial" | "monthly" | "yearly" | "bespoke";
    features: string[];
    seatLimit: number;
    matterLimit: number;
    isPopular: boolean;
    showOnLanding: boolean;
    isActive: boolean;
    sortOrder: number;
    ctaLabel: string;
  }>
): Promise<{ ok: true; changes: string[] }> {
  return api(`/api/admin/subscriptions/${key}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/* ─── Clients: update / delete ───────────────────────────────────────── */

export async function partnerUpdateClient(
  id: string,
  payload: Partial<PartnerClientInput>
): Promise<{
  ok: true;
  client: Omit<PartnerClient, "caseCount"> & { updatedAt: string };
}> {
  return api(`/api/app/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteClient(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/clients/${id}`, { method: "DELETE" });
}

/* ─── Courts: update / delete ────────────────────────────────────────── */

export async function partnerUpdateCourt(
  id: string,
  payload: Partial<PartnerCourtInput>
): Promise<{ ok: true; court: PartnerCourt }> {
  return api(`/api/app/courts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteCourt(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/courts/${id}`, { method: "DELETE" });
}

/* ─── Boards: update / delete ────────────────────────────────────────── */

export async function partnerUpdateBoard(
  id: string,
  payload: Partial<PartnerBoardInput>
): Promise<{ ok: true; board: PartnerBoard }> {
  return api(`/api/app/boards/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteBoard(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/boards/${id}`, { method: "DELETE" });
}

/* ─── Disposed cases (archive) ───────────────────────────────────────── */

export type DisposedCase = {
  id: string;
  caseNo: string;
  fileNo: string;
  cnr: string;
  title: string;
  clientName: string;
  clientPhone: string;
  clientWhatsapp: string;
  oppositeParty: string;
  courtName: string;
  courtHall: string;
  courtPlace: string;
  status: string;
  appearingFor: string;
  disposedAt: string | null;
  disposalDate: string | null;
  disposalRemarks: string;
  caStatus: string;
  receivedByClient: boolean;
  lastHearingDate: string | null;
  createdAt: string;
  updatedAt: string;
};

// Newest disposal first, capped at 500 server-side. Disposing/reopening
// itself is a partnerUpdateCase() status transition ("Disposed" ⇄ other),
// admin-only on the server.
export async function partnerListDisposedCases(): Promise<{
  cases: DisposedCase[];
}> {
  return api<{ cases: DisposedCase[] }>("/api/app/cases/disposed", {
    method: "GET",
  });
}

/* ─── Case documents (GridFS) ────────────────────────────────────────── */

export type CaseDocumentDTO = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  uploadedByName: string;
  uploadedByUserId: string | null;
  createdAt: string;
};

export async function partnerListCaseDocuments(
  caseId: string
): Promise<{ documents: CaseDocumentDTO[] }> {
  return api(`/api/app/cases/${caseId}/documents`, { method: "GET" });
}

/** Streaming/download path for a stored document. `download` switches the
 *  server's Content-Disposition from inline (preview) to attachment. */
export function caseDocumentPath(
  caseId: string,
  docId: string,
  opts?: { download?: boolean }
): string {
  return `/api/app/cases/${caseId}/documents/${docId}${
    opts?.download ? "?download=1" : ""
  }`;
}

// Delete uses the same smart-delete flow as cases/clients: non-admins get
// a 403 with code delete_request_required (targetType "case_document") —
// read it with deleteRequestRequired() and offer the request-delete sheet.
export async function partnerDeleteCaseDocument(
  caseId: string,
  docId: string
): Promise<{ ok: true }> {
  return api(`/api/app/cases/${caseId}/documents/${docId}`, {
    method: "DELETE",
  });
}

/* ─── Senior Desk: chat ──────────────────────────────────────────────── */

export type ChatRoomDTO = {
  id: string;
  type: "group" | "private";
  title: string;
  // Private rooms: the OTHER party. Group room: null.
  otherUser: {
    id: string;
    name: string;
    role: string;
    active: boolean;
  } | null;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  lastMessageAuthorId: string | null;
  unreadCount: number;
};

export type ChatAttachment = {
  id: string;
  filename: string;
  contentType: string;
  size: number;
};

export type ChatMessageDTO = {
  id: string;
  roomId: string;
  senderId: string | null;
  senderName: string;
  senderRole: string;
  body: string;
  attachments?: ChatAttachment[];
  type: "text" | "system";
  isDeleted: boolean;
  editedAt: string | null;
  createdAt: string;
  isMine: boolean;
  // Delivery/read state on YOUR OWN messages; null on everyone else's.
  // Absent on older servers, which simply means no tick is drawn.
  receipt?: "sent" | "delivered" | "read" | null;
};

export const CHAT_MAX_BODY = 4000;

export async function partnerChatRooms(): Promise<{
  rooms: ChatRoomDTO[];
  totalUnread: number;
}> {
  return api("/api/app/chat/rooms", { method: "GET" });
}

export async function partnerChatStartPrivate(
  withUserId: string
): Promise<{ ok: true; room: ChatRoomDTO }> {
  return api("/api/app/chat/private", {
    method: "POST",
    body: JSON.stringify({ withUserId }),
  });
}

// Oldest-first page of up to `limit` messages strictly BEFORE the cursor
// (newest `limit` when no cursor) — render top-to-bottom without reversing.
export async function partnerChatMessages(
  roomId: string,
  opts?: { before?: string; limit?: number }
): Promise<{
  messages: ChatMessageDTO[];
  hasMore: boolean;
  room: { id: string; type: "group" | "private"; title: string };
}> {
  const qs = new URLSearchParams();
  if (opts?.before) qs.set("before", opts.before);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const suffix = qs.toString();
  return api(
    `/api/app/chat/rooms/${roomId}/messages${suffix ? `?${suffix}` : ""}`,
    { method: "GET" }
  );
}

export async function partnerChatSend(
  roomId: string,
  body: string,
  attachments?: ChatAttachment[]
): Promise<{ ok: true; message: ChatMessageDTO }> {
  return api(`/api/app/chat/rooms/${roomId}/messages`, {
    method: "POST",
    body: JSON.stringify({ body, attachments: attachments ?? [] }),
  });
}

export async function partnerChatEditMessage(
  messageId: string,
  body: string
): Promise<{ ok: true; message: { body: string; editedAt: string | null } }> {
  return api(`/api/app/chat/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify({ body }),
  });
}

export async function partnerChatDeleteMessage(
  messageId: string,
  scope: "me" | "everyone" = "everyone"
): Promise<{ ok: true }> {
  return api(`/api/app/chat/messages/${messageId}?scope=${scope}`, {
    method: "DELETE",
  });
}

// Marks the room read up to messageId (or the room's newest when omitted).
export async function partnerChatMarkRead(
  roomId: string,
  messageId?: string
): Promise<{ ok: true }> {
  return api(`/api/app/chat/rooms/${roomId}/read`, {
    method: "POST",
    body: JSON.stringify(messageId ? { messageId } : {}),
  });
}

export async function partnerChatUnread(): Promise<{
  totalUnread: number;
  groupUnread: number;
  privateUnread: number;
  byRoomId: Record<string, number>;
}> {
  return api("/api/app/chat/unread", { method: "GET" });
}

/* ─── Senior Desk: reminders ─────────────────────────────────────────── */

export type ReminderPriority = "low" | "normal" | "high";

export type ReminderBucket =
  | "mine_active"
  | "mine_done"
  | "office_active" // admin-only
  | "office_done"; // admin-only

export type ReminderDTO = {
  id: string;
  title: string;
  description: string;
  dueDate: string | null;
  priority: ReminderPriority;
  assignedToUserId: string;
  assignedToName: string;
  createdByUserId: string;
  createdByName: string;
  status: "pending" | "done";
  completedAt: string | null;
  isMine: boolean;
  isOverdue: boolean;
  isDueToday: boolean;
  createdAt: string;
};

export async function partnerListReminders(
  bucket: ReminderBucket
): Promise<{ reminders: ReminderDTO[]; dueOrOverdueCount: number }> {
  return api(`/api/app/reminders?bucket=${bucket}`, { method: "GET" });
}

export async function partnerCreateReminder(payload: {
  title: string;
  description?: string;
  dueDate?: string | null;
  priority?: ReminderPriority;
  assignedToUserId?: string; // defaults to the caller on the server
}): Promise<{ ok: true; reminder: ReminderDTO }> {
  return api("/api/app/reminders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Status toggle: assignee/creator/admin. Other fields: creator/admin.
export async function partnerUpdateReminder(
  id: string,
  payload: Partial<{
    title: string;
    description: string;
    dueDate: string | null;
    priority: ReminderPriority;
    assignedToUserId: string;
    status: "pending" | "done";
  }>
): Promise<{ ok: true; reminder: ReminderDTO }> {
  return api(`/api/app/reminders/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function partnerDeleteReminder(
  id: string
): Promise<{ ok: true }> {
  return api(`/api/app/reminders/${id}`, { method: "DELETE" });
}

/* ─── Attendance (office admin) ──────────────────────────────────────── */

export type AttendanceStatus =
  | "present"
  | "absent"
  | "half_day"
  | "leave"
  | "holiday";

export type AttendanceUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  isYou: boolean;
};

export type AttendanceRecord = {
  id: string;
  userId: string;
  date: string;
  status: AttendanceStatus;
  note: string;
  markedByName: string;
  markedAt: string;
};

export type AttendanceUserSummary = {
  present: number;
  absent: number;
  halfDay: number;
  leave: number;
  holiday: number;
  attendancePct: number;
};

export type AttendanceMonth = {
  month: string; // "YYYY-MM"
  totalDays: number;
  daysSoFar: number;
  users: AttendanceUser[];
  records: AttendanceRecord[];
  summary: {
    perUser: Record<string, AttendanceUserSummary>;
    office: {
      avgAttendancePct: number;
      totalUsers: number;
      totalMarked: number;
      totalPossible: number;
    };
  };
  isAdmin: boolean;
};

export async function partnerGetAttendance(
  month?: string // "YYYY-MM", defaults to the current month server-side
): Promise<AttendanceMonth> {
  const suffix = month ? `?month=${month}` : "";
  return api(`/api/app/attendance${suffix}`, { method: "GET" });
}

// Admin-only. An empty-string status CLEARS the day's mark. Future dates
// are rejected server-side (IST midnight boundary).
export async function partnerMarkAttendance(payload: {
  userId: string;
  date: string;
  status: AttendanceStatus | "";
  note?: string;
}): Promise<
  | { ok: true; cleared: true }
  | {
      ok: true;
      record: Omit<AttendanceRecord, "markedByName">;
    }
> {
  return api("/api/app/attendance", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/* ─── Office settings ────────────────────────────────────────────────── */

export type OfficeSettings = {
  // null = keep forever; otherwise prune activity older than N days.
  // Mirrors VALID_RETENTION in the API's app/settings route.
  activityRetentionDays: 90 | 180 | 365 | null;
};

export async function partnerGetSettings(): Promise<{
  settings: OfficeSettings;
}> {
  return api("/api/app/settings", { method: "GET" });
}

// Admin-only on the server.
export async function partnerUpdateSettings(
  payload: Partial<OfficeSettings>
): Promise<{ ok: true; settings: OfficeSettings }> {
  return api("/api/app/settings", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}


/* ─── Push tokens ─────────────────────────────────────────────────────
   The address this device is reachable at. Registered after sign-in,
   handed back on sign-out — a shared office phone that kept a signed-out
   advocate's token would keep showing their chambers' notifications to
   whoever picked it up next. */

export async function partnerRegisterPushToken(payload: {
  token: string;
  platform: "ios" | "android";
  deviceName?: string;
}): Promise<{ ok: true }> {
  return api("/api/app/push", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function partnerRevokePushToken(
  token: string
): Promise<{ ok: true }> {
  return api("/api/app/push", {
    method: "DELETE",
    body: JSON.stringify({ token }),
  });
}
