import { useEffect } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "../lib/auth-context";

// Post-login routing screen. Reads from AuthContext rather than re-
// running getMe — the provider's boot probe is the single round-trip
// for the whole app lifecycle.
//
//   global_admin → /(admin)/dashboard (Pocket Plex shell)
//   partner_admin / user → /(home)/home (Midnight Counsel shell)
//   no session → /signin
//
// The component itself renders the "Opening chambers…" spinner only
// while the AuthContext probe is in flight, which is normally a single
// frame after a fresh launch and zero frames when navigated to from
// signin (already authenticated by then).
export default function DashboardRouter() {
  const router = useRouter();
  const { status, isGlobalAdmin } = useAuth();

  useEffect(() => {
    if (status === "loading") return;
    if (status === "guest") {
      router.replace("/signin");
      return;
    }
    router.replace(isGlobalAdmin ? "/(admin)/dashboard" : "/(home)/home");
  }, [status, isGlobalAdmin, router]);

  return (
    <View className="flex-1 bg-paper items-center justify-center">
      <ActivityIndicator color="#b68b3c" size="large" />
      <Text
        className="mt-4 font-mono text-[10px] uppercase text-ink-soft"
        style={{ letterSpacing: 2.5 }}
      >
        Opening chambers…
      </Text>
    </View>
  );
}
