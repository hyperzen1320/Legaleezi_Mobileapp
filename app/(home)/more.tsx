import { useState } from "react";
import {
  Alert,
  ScrollView,
  View,
  Text,
  Pressable,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import ConfirmSheet from "../../components/ConfirmSheet";
import { ApiError, partnerCreateSupportTicket } from "../../lib/api";
import { openSection } from "../../lib/navigation";
import { withReturn } from "../../components/useReturnTo";
import { useAuth } from "../../lib/auth-context";
import { useChatUnread } from "../../lib/chat-unread";
import { useNotificationCount } from "../../lib/notification-count";
import { isFeatureEnabled, type FeatureKey } from "../../lib/features";

type MoreItem = {
  label: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  comingSoon?: boolean;
  badge?: number;
  onPress?: () => void;
  // The module switch this entry belongs to. Absent = always available
  // (My Profile, Support and Sign out aren't modules).
  feature?: FeatureKey;
};

export default function More() {
  const router = useRouter();
  const { user, partner, isPartnerAdmin, logout, logoutAllDevices, features } =
    useAuth();
  const { unread } = useChatUnread();
  // Pending delete requests waiting on the admin. The singleton already
  // polls this partner-wide, so the count costs nothing extra here.
  const { count: pendingDeletes } = useNotificationCount();
  const [confirmAll, setConfirmAll] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [signOutAllError, setSignOutAllError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [requestingDelete, setRequestingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Google Play requires an in-app way to ask for an account to be
  // deleted, for any app people can sign up in. The request lands in the
  // Legaleezi team's support inbox (the same one Support → Report an issue
  // feeds), who confirm with the advocate before deleting anything — an
  // office admin's account carries the whole chambers with it.
  async function onRequestDelete() {
    if (!user) return;
    setRequestingDelete(true);
    setDeleteError(null);
    try {
      await partnerCreateSupportTicket({
        subject: "Account deletion request",
        category: "Other",
        message: [
          "Please delete my Legaleezi account and the personal data tied to it.",
          "",
          `Name: ${[user.firstName, user.lastName].filter(Boolean).join(" ")}`,
          `Email: ${user.email}`,
          `Role: ${isPartnerAdmin ? "Office admin" : "Office member"}`,
          `Chambers: ${partner?.name ?? "—"}`,
          "",
          "Sent from the mobile app (More → Delete my account).",
        ].join("\n"),
      });
      setConfirmDelete(false);
      Alert.alert(
        "Request sent",
        `The Legaleezi team will contact you at ${user.email} to confirm before anything is deleted.`
      );
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : "Couldn't send the request. Try again."
      );
    } finally {
      setRequestingDelete(false);
    }
  }

  async function onSignOut() {
    await logout();
    router.replace("/");
  }

  async function onSignOutAll() {
    setSigningOutAll(true);
    setSignOutAllError(null);
    try {
      await logoutAllDevices();
      setConfirmAll(false);
      router.replace("/");
    } catch (err) {
      // 404 = the server hasn't been updated with the endpoint yet.
      setSignOutAllError(
        err instanceof ApiError && err.status === 404
          ? "Not available yet — this needs a server update that hasn't been deployed. Nothing changed: you're still signed in everywhere."
          : err instanceof Error
            ? err.message
            : "Couldn't sign out of all devices. Try again."
      );
      setSigningOutAll(false);
    }
  }

  const tools: MoreItem[] = [
    {
      label: "Senior Desk",
      feature: "seniorDesk",
      description: "Office chat, private notes & reminders",
      icon: "message-square",
      badge: unread.totalUnread,
      onPress: () => openSection("/(home)/senior-desk"),
    },
    {
      label: "Client Crew",
      feature: "clients",
      description: "Clients & linked matters",
      icon: "users",
      onPress: () => openSection("/(home)/clients"),
    },
    {
      label: "Court Hub",
      feature: "courts",
      description: "Master list of courts",
      icon: "home",
      onPress: () => openSection("/(home)/courts"),
    },
    {
      label: "Work Flow",
      feature: "workflow",
      description: "Boards for the office's own processes",
      icon: "layout",
      onPress: () => openSection("/(home)/workflow"),
    },
    {
      label: "AI Assistant",
      feature: "ai",
      description: "Drafts, plaints, prompts",
      icon: "zap",
      onPress: () => openSection("/(home)/ai"),
    },
    {
      label: "Disposed Cases",
      feature: "disposed",
      description: "Closed matters archive",
      icon: "archive",
      onPress: () =>
        openSection(withReturn("/(home)/cases/disposed", "more") as never),
    },
    {
      label: "Users / Advocates",
      feature: "users",
      description: "Office team & roles",
      icon: "user-plus",
      onPress: () => openSection("/(home)/users"),
    },
    {
      label: "Our website",
      description: "Visit our public site — legalezi.com",
      icon: "external-link",
      onPress: () => Linking.openURL("https://legalezi.com"),
    },
    // Office-admin desk — mirrors the web sidebar's admin-only items.
    ...(isPartnerAdmin
      ? ([
          {
            label: "Attendance",
      feature: "attendance",
            description: "The office register, day by day",
            icon: "check-square",
            onPress: () => openSection("/(home)/attendance"),
          },
          {
            label: "Delete Requests",
            description: "Approve or reject what the office asked to remove",
            icon: "trash-2",
            badge: pendingDeletes,
            onPress: () => openSection("/(home)/delete-requests"),
          },
          {
            label: "Office Activity",
            feature: "activity",
            description: "Audit log of everything that happened",
            icon: "activity",
            onPress: () => openSection("/(home)/activity"),
          },
          {
            label: "Office Settings",
            description: "Activity retention & housekeeping",
            icon: "settings",
            onPress: () => openSection("/(home)/settings"),
          },
        ] as MoreItem[])
      : []),
    {
      label: "Tools",
      description: "Handy tools for your practice",
      icon: "tool",
      onPress: () => openSection("/(home)/tools"),
    },
  ];

  // Drop anything the global admin has switched off for this chambers.
  // The screens redirect and the APIs 403 regardless — this is so the
  // menu doesn't advertise a door that won't open.
  const visibleTools = tools.filter(
    (t) => !t.feature || isFeatureEnabled(features, t.feature)
  );

  const account: MoreItem[] = [
    {
      label: "My Profile",
      description: "Identity & signature",
      icon: "user",
      onPress: () => openSection("/(home)/profile"),
    },
    {
      label: "Support",
      description: "Tutorials & report an issue",
      icon: "life-buoy",
      onPress: () => openSection("/(home)/support"),
    },
    {
      label: "Sign out",
      description: "End this session",
      icon: "log-out",
      onPress: onSignOut,
    },
    {
      label: "Sign out of all devices",
      description: "Every phone, tablet and browser — this one too",
      icon: "smartphone",
      onPress: () => {
        setSignOutAllError(null);
        setConfirmAll(true);
      },
    },
    {
      label: "Delete my account",
      description: "Ask the Legaleezi team to delete your account",
      icon: "user-x",
      onPress: () => {
        setDeleteError(null);
        setConfirmDelete(true);
      },
    },
  ];

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar />
        <ScrollView
          contentContainerClassName="px-5 pt-5 pb-6"
          showsVerticalScrollIndicator={false}
        >
          {/* Identity card */}
          {user ? (
            <View
              className="rounded-2xl px-5 py-5 flex-row items-center gap-4"
              style={{
                backgroundColor: "#0a1124",
                shadowColor: "#0a1124",
                shadowOpacity: 0.18,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 6 },
                elevation: 6,
              }}
            >
              <View
                className="h-14 w-14 items-center justify-center rounded-full"
                style={{ backgroundColor: "#c5853a" }}
              >
                <Text
                  className="text-[18px] font-semibold uppercase"
                  style={{
                    fontFamily: "Crimson-SemiBold",
                    color: "#2a1c08",
                  }}
                >
                  {(user.firstName[0] || "").toUpperCase()}
                  {(user.lastName[0] || "").toUpperCase()}
                </Text>
              </View>
              <View className="flex-1 min-w-0">
                <Text
                  className="text-[10px] uppercase text-app-copper-bright"
                  style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
                >
                  Signed in
                </Text>
                <Text
                  className="mt-0.5 text-[18px] font-semibold tracking-tight text-app-ivory leading-tight"
                  style={{ fontFamily: "Crimson-SemiBold" }}
                  numberOfLines={1}
                >
                  {user.firstName} {user.lastName}
                </Text>
                <Text
                  className="mt-0.5 text-[11px] text-app-ivory-soft"
                  style={{ fontFamily: "DMMono", letterSpacing: 0.4 }}
                  numberOfLines={1}
                >
                  {user.email}
                </Text>
                {partner ? (
                  <Text
                    className="mt-1 text-[12px]"
                    style={{
                      fontFamily: "Manrope-Medium",
                      color: "#ddb074",
                    }}
                    numberOfLines={1}
                  >
                    {partner.name}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* Tools section */}
          <SectionLabel>More tools</SectionLabel>
          <Section items={visibleTools} />

          {/* Account section */}
          <SectionLabel>Account</SectionLabel>
          <Section items={account} />

          {/* Footer */}
          <View className="mt-8 items-center">
            <Text
              className="text-[10px] uppercase text-app-fg-muted"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.5 }}
            >
              v1.0 · Phase 1 MVP
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>

      <ConfirmSheet
        visible={confirmAll}
        onClose={() => setConfirmAll(false)}
        onConfirm={onSignOutAll}
        title="Sign out of all devices?"
        message="You'll be signed out on every phone, tablet and browser using your account, including this one. Anyone on them — you included — will have to sign in again with your password."
        confirmLabel="Sign out everywhere"
        icon="log-out"
        busy={signingOutAll}
        error={signOutAllError}
      />

      <ConfirmSheet
        visible={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={onRequestDelete}
        title="Delete your account?"
        message={
          isPartnerAdmin
            ? "This asks the Legaleezi team to delete your account. You're the office admin, so that means your chambers' account and its records too. The team will contact you to confirm before anything is deleted."
            : "This asks the Legaleezi team to delete your account and the personal data tied to it. Your office's cases stay with the office. The team will contact you to confirm before anything is deleted."
        }
        confirmLabel="Send request"
        icon="user-x"
        busy={requestingDelete}
        error={deleteError}
      />
    </View>
  );
}

function TopBar() {
  return (
    <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5">
      <Text
        className="text-[10px] uppercase text-app-copper-deep"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        Settings & shortcuts
      </Text>
      <Text
        className="mt-0.5 text-[18px] font-semibold tracking-tight text-app-ink leading-none"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        More
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text
      className="mt-7 mb-3 text-[10px] uppercase text-app-copper-deep"
      style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
    >
      {children}
    </Text>
  );
}

function Section({ items }: { items: MoreItem[] }) {
  return (
    <View
      className="rounded-2xl bg-app-paper overflow-hidden"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}
    >
      {items.map((it, i) => (
        <Pressable
          key={it.label}
          onPress={it.onPress}
          disabled={!it.onPress && it.comingSoon}
          className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-50"
          style={{
            borderBottomWidth: i < items.length - 1 ? 1 : 0,
            borderBottomColor: "#efe5d0",
            opacity: it.comingSoon ? 0.7 : 1,
          }}
        >
          <View
            className="h-9 w-9 items-center justify-center rounded-md"
            style={{ backgroundColor: "#efe5d0" }}
          >
            <Feather name={it.icon} size={16} color="#8a5821" />
          </View>
          <View className="flex-1">
            <Text
              className="text-[14px] font-semibold text-app-ink"
              style={{ fontFamily: "Manrope-SemiBold" }}
            >
              {it.label}
            </Text>
            <Text
              className="mt-0.5 text-[11px] text-app-fg-muted"
              style={{ fontFamily: "Manrope" }}
            >
              {it.description}
            </Text>
          </View>
          {it.badge && it.badge > 0 ? (
            <View
              className="items-center justify-center rounded-full"
              style={{
                minWidth: 20,
                height: 20,
                paddingHorizontal: 5,
                backgroundColor: "#c5853a",
              }}
            >
              <Text
                style={{
                  fontFamily: "DMMono-Medium",
                  fontSize: 10,
                  color: "#2a1c08",
                }}
              >
                {it.badge > 99 ? "99+" : it.badge}
              </Text>
            </View>
          ) : null}
          {it.comingSoon ? (
            <View
              className="rounded-sm px-1.5 py-0.5"
              style={{ backgroundColor: "#efe5d0" }}
            >
              <Text
                className="text-[9px] uppercase"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.2,
                  color: "#8a5821",
                }}
              >
                Soon
              </Text>
            </View>
          ) : (
            <Feather name="chevron-right" size={14} color="#8a5821" />
          )}
        </Pressable>
      ))}
    </View>
  );
}
