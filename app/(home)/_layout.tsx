import { useEffect } from "react";
import { Tabs, useRouter } from "expo-router";
import { View, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth-context";
import { useChatUnread } from "../../lib/chat-unread";
import { isFeatureEnabled } from "../../lib/features";

export default function HomeLayout() {
  const router = useRouter();
  const { status, isGlobalAdmin, features } = useAuth();
  // Senior Desk unread total rides on the More tab (web puts it on the
  // sidebar item). The singleton polls every 12s while the app is open.
  const { unread } = useChatUnread();
  const insets = useSafeAreaInsets();

  // Modules the global admin has switched off for this chambers lose
  // their tab. `href: null` keeps the route registered (so a stray
  // navigation still resolves) while taking it out of the bar — the same
  // treatment the non-tab screens below already get. The API 403s these
  // regardless, so this is about not showing a door that doesn't open.
  const showCases = isFeatureEnabled(features, "cases");
  const showHearings = isFeatureEnabled(features, "hearings");

  // Two redirects this layout enforces:
  //  - no session → back to signin
  //  - global_admin landed here by accident → bounce to admin shell
  // We don't run our own getMe probe; AuthContext already did that on
  // mount and any session change re-renders this layout.
  useEffect(() => {
    if (status === "loading") return;
    if (status === "guest") {
      router.replace("/signin");
      return;
    }
    if (isGlobalAdmin) router.replace("/(admin)/dashboard");
  }, [status, isGlobalAdmin, router]);

  if (status !== "authenticated" || isGlobalAdmin) {
    return (
      <View
        className="flex-1 items-center justify-center"
        style={{ backgroundColor: "#f4ede0" }}
      >
        <ActivityIndicator color="#c5853a" size="large" />
      </View>
    );
  }

  return (
    <Tabs
      // Back goes to the tab you were last on, not to Dashboard.
      //
      // Most of this app's screens — Work Flow, Senior Desk, Court Hub,
      // Attendance, the lot — are tabs with `href: null`, reached from the
      // More menu. With the navigator's default ("firstRoute"), backing out
      // of any of them dropped you on Dashboard, so More → Work Flow → back
      // meant three taps to get back to where you started. "history" walks
      // the tabs actually visited instead.
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // Every tab opens at its own root.
        //
        // Several tabs are stacks that OTHER tabs push into: the Hearing
        // Track and Today's Board open a case dossier inside the Cases
        // stack, More opens the disposed archive there, the bell opens a
        // board inside Work Flow. Nothing ever unwound those, so the
        // depth accumulated: a dossier opened from the diary on Monday
        // was still sitting under the Case Vault on Tuesday, and tapping
        // Case Vault pushed a second copy of the list on top of it —
        // which is why backing out of a case landed on some unrelated
        // matter before reaching the dashboard.
        //
        // popToTopOnBlur unwinds a tab's stack the moment you leave it,
        // so a tab can only ever hold depth you created while you were
        // standing in it. One flag, and the whole class of stale-screen
        // bugs stops being possible.
        popToTopOnBlur: true,
        // Cross-fade + drift between tabs instead of a hard card swap.
        animation: "shift",
        tabBarActiveTintColor: "#c5853a",
        tabBarInactiveTintColor: "#7a7060",
        // Explicitly reserve the device's bottom inset. With edge-to-edge
        // enabled, leaving it to the navigator lets the system nav bar paint
        // over the labels — so we size the bar = content + inset and pad the
        // bottom by the inset (min 8). Labels then clear the gesture pill AND
        // 3-button navigation on every device size.
        tabBarStyle: {
          backgroundColor: "#0a1124",
          borderTopColor: "#1f2a45",
          borderTopWidth: 1,
          paddingTop: 6,
          // Older / smaller phones (no gesture pill → insets.bottom === 0)
          // were clipping the labels; a taller floor + a 12px bottom-padding
          // floor keeps all five fully visible everywhere.
          height: 66 + insets.bottom,
          paddingBottom: Math.max(insets.bottom, 12),
        },
        // Four tabs instead of five leaves room to read them: 10.5px still
        // keeps every label on one line on the narrowest phones.
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontFamily: "DMMono-Medium",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginTop: 3,
        },
        tabBarItemStyle: { paddingVertical: 2 },
        sceneStyle: { backgroundColor: "#f4ede0" },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          tabBarLabel: "Dashboard",
          tabBarIcon: ({ color }) => (
            <Feather name="grid" size={20} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="cases"
        options={
          showCases
            ? {
                tabBarLabel: "Cases",
                tabBarIcon: ({ color }) => (
                  <Feather name="briefcase" size={20} color={color} />
                ),
              }
            : { href: null }
        }
      />
      <Tabs.Screen
        name="hearings"
        options={
          showHearings
            ? {
                tabBarLabel: "Hearings",
                tabBarIcon: ({ color }) => (
                  <Feather name="calendar" size={20} color={color} />
                ),
              }
            : { href: null }
        }
      />
      <Tabs.Screen
        name="more"
        options={{
          tabBarLabel: "More",
          tabBarIcon: ({ color }) => (
            <Feather name="menu" size={20} color={color} />
          ),
          tabBarBadge:
            unread.totalUnread > 0
              ? unread.totalUnread > 99
                ? "99+"
                : unread.totalUnread
              : undefined,
          tabBarBadgeStyle: {
            backgroundColor: "#c5853a",
            color: "#2a1c08",
            fontFamily: "DMMono-Medium",
            fontSize: 9,
          },
        }}
      />
      <Tabs.Screen name="clients" options={{ href: null }} />
      <Tabs.Screen name="courts" options={{ href: null }} />
      <Tabs.Screen name="ai" options={{ href: null }} />
      {/* Profile moved off the bar to the Dashboard's top-right, beside
          the bell — a fifth tab for a screen visited once a month was
          crowding the four that get used every day. More → My Profile is
          still the second door. */}
      <Tabs.Screen name="profile" options={{ href: null }} />
      <Tabs.Screen name="users" options={{ href: null }} />
      <Tabs.Screen name="workflow" options={{ href: null }} />
      <Tabs.Screen name="senior-desk" options={{ href: null }} />
      <Tabs.Screen name="activity" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="attendance" options={{ href: null }} />
      <Tabs.Screen name="support" options={{ href: null }} />
      <Tabs.Screen name="tools" options={{ href: null }} />
      <Tabs.Screen name="delete-requests" options={{ href: null }} />
      <Tabs.Screen name="tutorials" options={{ href: null }} />
    </Tabs>
  );
}
