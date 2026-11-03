// Per-chambers module switches, mirroring legaleasy/src/lib/features.ts.
//
// The global admin decides which parts of Legaleezi an office can reach.
// Everything ships ON: a key that isn't in the map is enabled, which is
// why no existing chambers changed when this arrived.
//
// This file is presentation only. The server enforces the same map on
// every /api/app/* request, so an app that ignored these switches would
// simply get 403s — hiding the entry is the courtesy, not the control.

export const FEATURE_KEYS = [
  "cases",
  "clients",
  "hearings",
  "courts",
  "workflow",
  "seniorDesk",
  "ai",
  "disposed",
  "activity",
  "attendance",
  "users",
  "exports",
  "imports",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureMap = Partial<Record<FeatureKey, boolean>>;

const KEY_SET = new Set<string>(FEATURE_KEYS);

/**
 * Normalises whatever /me returned. An older backend sends nothing at
 * all, which reads as "everything on" — exactly the behaviour before
 * module switches existed.
 */
export function readFeatures(raw: unknown): FeatureMap {
  if (!raw || typeof raw !== "object") return {};
  const out: FeatureMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (KEY_SET.has(k) && typeof v === "boolean") out[k as FeatureKey] = v;
  }
  return out;
}

/** Absent means enabled — see the note at the top of this file. */
export function isFeatureEnabled(
  features: FeatureMap | undefined | null,
  key: FeatureKey
): boolean {
  return features?.[key] !== false;
}
