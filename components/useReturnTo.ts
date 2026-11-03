import { useCallback } from "react";
import { BackHandler } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

// Back for a screen that lives in one tab's stack but is opened from
// another — More → Disposed Cases, the dashboard's "Add a case", the
// bell's board links. `router.back()` there can only pop within the
// stack the screen lives in, so it landed in the Case Vault or the Work
// Flow list instead of where the advocate pressed.
//
// The opener appends `?back=<origin>` and the screen calls this hook.
// The same idea as useCaseOrigin for the case dossier; this one is for
// every other screen, and reads `back` because the new-case form already
// uses `from` for "duplicate this matter".

export type ReturnOrigin = "home" | "more";

const ORIGINS: Record<ReturnOrigin, { href: string; label: string }> = {
  home: { href: "/(home)/home", label: "Dashboard" },
  more: { href: "/(home)/more", label: "More" },
};

/** `withReturn("/(home)/cases/disposed", "more")` → `…?back=more`. */
export function withReturn(href: string, origin: ReturnOrigin): string {
  return `${href}${href.includes("?") ? "&" : "?"}back=${origin}`;
}

/**
 * The origin this screen was opened from (null when it was opened from
 * inside its own stack), plus a back handler that returns there. Also
 * takes over the Android hardware back while the screen is focused, so
 * the arrow and the hardware button always agree.
 */
export function useReturnTo(): {
  origin: ReturnOrigin | null;
  goBack: () => void;
} {
  const router = useRouter();
  const { back } = useLocalSearchParams<{ back?: string }>();
  const origin = back === "home" || back === "more" ? back : null;

  const goBack = useCallback(() => {
    if (!origin) {
      router.back();
      return;
    }
    // Hop to the tab that sent us here; popToTopOnBlur in (home)/_layout
    // unwinds this stack as it loses focus. `replace` keeps the tab we're
    // leaving out of the tab history, as useCaseOrigin does.
    router.replace(ORIGINS[origin].href as never);
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

  return { origin, goBack };
}
