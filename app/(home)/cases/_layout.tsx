import { Stack } from "expo-router";

// The vault is always the bottom of this stack, even when another tab
// opens a screen in here first (Disposed Cases, Add a case, a dossier).
// That keeps popToTopOnBlur able to unwind to it. The openers use
// openInTab() from lib/navigation, which is what loads the anchor.
export const unstable_settings = { anchor: "index" };

export default function CasesStack() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "#f4ede0" },
        animation: "slide_from_right",
      }}
    />
  );
}
