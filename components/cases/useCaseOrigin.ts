import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

// Where a matter was opened from, and how to get back there.
//
// The dossier route lives inside the Cases stack, so `router.back()` can
// only ever pop to the Case Vault — which is right when that's where you
// came from, and wrong from anywhere else. Opening a matter off the
// Hearing Track or the dashboard's Today's Board and pressing back
// stranded you in the vault, several taps from the list you were reading.
//
// So the openers say where they came from and this resolves it. Screens
// inside the Cases stack (the vault itself, the disposed archive) pass
// nothing: their own stack already pops correctly.

export type CaseOrigin = {
  href: string;
  /** What the dossier's top bar calls the place you'll return to. */
  label: string;
};

/** Query the case route reads: `?from=hearings&bucket=pending`, `?from=home`. */
export function caseHref(
  id: string,
  from?: "hearings" | "home",
  bucket?: string
): string {
  const base = `/(home)/cases/${id}`;
  if (!from) return base;
  const qs = new URLSearchParams({ from });
  if (from === "hearings" && bucket) qs.set("bucket", bucket);
  return `${base}?${qs.toString()}`;
}

function resolveOrigin(from?: string, bucket?: string): CaseOrigin | null {
  if (from === "home") {
    return { href: "/(home)/home", label: "Dashboard" };
  }
  if (from === "hearings") {
    // Land back on the same tab of the diary, not whichever one it
    // happens to open on.
    const b =
      bucket === "tomorrow" || bucket === "pending" ? bucket : "today";
    return { href: `/(home)/hearings?bucket=${b}`, label: "Hearing Track" };
  }
  return null;
}

/**
 * Reads the origin off the route and returns the label for the top bar
 * plus the handler for its back button. Also takes over the Android
 * hardware back while the dossier is focused, so both routes out behave
 * the same.
 */
export function useCaseOrigin(): { label: string; goBack: () => void } {
  const router = useRouter();
  const { from, bucket } = useLocalSearchParams<{
    from?: string;
    bucket?: string;
  }>();
  const origin = resolveOrigin(from, bucket);

  const goBack = useCallback(() => {
    if (!origin) {
      router.back();
      return;
    }
    // Hop to the tab that sent us here. Unwinding the Cases stack is the
    // navigator's job — popToTopOnBlur in (home)/_layout does it the
    // moment this tab loses focus, for every tab, so there is no second
    // dispatch to get out of order with this one. `replace` rather than
    // `navigate` so the Cases tab doesn't linger in the tab history as
    // somewhere the advocate meant to be.
    router.replace(origin.href as never);
  }, [origin, router]);

  useFocusEffect(
    useCallback(() => {
      if (!origin) return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        goBack();
        return true;
      });
      return () => sub.remove();
    }, [origin, goBack])
  );

  return { label: origin?.label ?? "Case Vault", goBack };
}
