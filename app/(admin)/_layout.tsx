import { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import { View, ActivityIndicator, type TextStyle } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth-context";
import { tabLabel as cappedLabel } from "../../components/TabLabel";

const TAB_LABEL_STYLE: TextStyle = {
  fontSize: 10,
  fontFamily: "PlexMono-Medium",
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginTop: 4,
};

const tabLabel = (text: string) => cappedLabel(text, TAB_LABEL_STYLE);

export default function AdminLayout() {
  const router = useRouter();
  const { status, isGlobalAdmin } = useAuth();

  // Mirror of home/_layout.tsx — partner users that wander into the
  // admin shell get bounced back, expired sessions land on signin.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "guest") {
      router.replace("/signin");
      return;
    }
    if (!isGlobalAdmin) router.replace("/(home)/home");
  }, [status, isGlobalAdmin, router]);

  if (status !== "authenticated" || !isGlobalAdmin) {
    return (
      <View className="flex-1 bg-admin-bg items-center justify-center">
        <ActivityIndicator color="#0e7c4a" size="large" />
      </View>
    );
  }

  return (
    <Tabs
      // Back walks the tabs actually visited, and every tab opens at its
      // own root — the same two rules the partner shell follows. Without
      // the second one the Partners stack kept whichever partner was last
      // opened from the dashboard, and going back walked through it.
      backBehavior="history"
      screenOptions={{
        popToTopOnBlur: true,
        headerShown: false,
        animation: "shift",
        tabBarActiveTintColor: "#0e7c4a",
        tabBarInactiveTintColor: "#8a929e",
        // The navigator adds the device's bottom safe area itself — no
        // manual inset math, so the bar never collides with gesture
        // pills or 3-button navigation.
        tabBarStyle: {
          backgroundColor: "#ffffff",
          borderTopColor: "#e8e6e0",
          borderTopWidth: 1,
          paddingTop: 6,
        },
        // Labels are rendered by tabLabel() above, so they can't outgrow
        // the bar when the phone's text size is turned up.
        tabBarItemStyle: { paddingVertical: 4 },
        sceneStyle: { backgroundColor: "#fafaf7" },
      }}
    >
      <Tabs.Screen
        name="dashboard"
        options={{
          tabBarLabel: tabLabel("Home"),
          tabBarIcon: ({ color, focused }) => (
            <Feather
              name="grid"
              size={20}
              color={color}
              style={{ opacity: focused ? 1 : 0.85 }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="partners"
        options={{
          tabBarLabel: tabLabel("Partners"),
          tabBarIcon: ({ color, focused }) => (
            <Feather
              name="users"
              size={20}
              color={color}
              style={{ opacity: focused ? 1 : 0.85 }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="subscriptions"
        options={{
          tabBarLabel: tabLabel("Plans"),
          tabBarIcon: ({ color, focused }) => (
            <Feather
              name="credit-card"
              size={20}
              color={color}
              style={{ opacity: focused ? 1 : 0.85 }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          tabBarLabel: tabLabel("Activity"),
          tabBarIcon: ({ color, focused }) => (
            <Feather
              name="activity"
              size={20}
              color={color}
              style={{ opacity: focused ? 1 : 0.85 }}
            />
          ),
        }}
      />
    </Tabs>
  );
}
