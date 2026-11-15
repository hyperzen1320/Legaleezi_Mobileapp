import { Stack } from "expo-router";

// The board list is always the bottom of this stack, even when the bell
// opens a board in here first. See the cases stack for why.
export const unstable_settings = { anchor: "index" };

export default function WorkflowStack() {
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
