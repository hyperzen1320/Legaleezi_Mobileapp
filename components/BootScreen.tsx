import { useEffect, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import Animated, { FadeIn } from "react-native-reanimated";

// The launch screen: the full Legaleezi logo, drawn at exactly the size
// and place the native splash draws it, so the hand-off from splash to JS
// is invisible. index holds it for LAUNCH_HOLD_MS from launch, then for as
// long as the session probe is still in flight — that slow-network tail is
// the only time the spinner shows.

// The logo artwork's own paper — app.json's splash backgroundColor.
const PAPER = "#f5eed8";
const BRASS = "#b68b3c";
// app.json's splash imageWidth. Android 12+ masks the splash image to a
// circle this wide; the artwork is laid out to sit inside it.
const LOGO_SIZE = 192;

export const LAUNCH_HOLD_MS = 1500;

// Starts when the bundle evaluates, a beat after the native splash is up.
const launchedAt = Date.now();

// True until LAUNCH_HOLD_MS after launch. Later mounts (index again after
// sign-out) get false straight away.
export function useLaunchHold() {
  const [holding, setHolding] = useState(
    () => Date.now() - launchedAt < LAUNCH_HOLD_MS
  );
  useEffect(() => {
    if (!holding) return;
    const t = setTimeout(
      () => setHolding(false),
      LAUNCH_HOLD_MS - (Date.now() - launchedAt)
    );
    return () => clearTimeout(t);
  }, [holding]);
  return holding;
}

export default function BootScreen({ waiting = false }: { waiting?: boolean }) {
  return (
    <View
      className="flex-1 items-center justify-center"
      style={{ backgroundColor: PAPER }}
    >
      <StatusBar style="dark" backgroundColor={PAPER} />

      <Image
        source={require("../assets/splash-icon.png")}
        style={{ height: LOGO_SIZE, width: LOGO_SIZE }}
        resizeMode="contain"
        accessibilityLabel="Legaleezi"
      />

      {/* Below the logo, positioned absolutely so the logo never moves. */}
      {waiting ? (
        <Animated.View
          entering={FadeIn.duration(400)}
          style={{
            position: "absolute",
            top: "50%",
            left: 0,
            right: 0,
            marginTop: LOGO_SIZE / 2 + 20,
            alignItems: "center",
          }}
        >
          <ActivityIndicator color={BRASS} />
        </Animated.View>
      ) : null}
    </View>
  );
}
