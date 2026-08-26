import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  partnerDashboard,
  partnerListBoards,
  type PartnerDashboardData,
} from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useChatUnread } from "../../lib/chat-unread";
import { isFeatureEnabled, type FeatureKey } from "../../lib/features";
import { useNotificationCount } from "../../lib/notification-count";
import { LiveOverview } from "../../components/LiveOverview";
import BellSheet from "../../components/BellSheet";
import { caseHref } from "../../components/cases/useCaseOrigin";
import { openSection } from "../../lib/navigation";

export default function PartnerHome() {
  const { user, partner, isPartnerAdmin } = useAuth();
  const { unread } = useChatUnread();
  const [data, setData] = useState<PartnerDashboardData | null>(null);
  const [boardCount, setBoardCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bellOpen, setBellOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // Boards ride alongside the dashboard so the Work Flow tile shows a
      // live count; a board failure must not blank the whole screen.
      const [dash, boards] = await Promise.all([
        partnerDashboard(),
        partnerListBoards().catch(() => ({ boards: [] })),
      ]);
      setData(dash);
      setBoardCount(boards.boards.length);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (loading) {
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
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar
          partnerName={partner?.name ?? "Your chambers"}
          initials={initialsOf(user?.firstName, user?.lastName)}
          onOpenBell={() => setBellOpen(true)}
        />
        <ScrollView
          contentContainerClassName="px-5 pt-5 pb-8"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#c5853a"
            />
          }
        >
          {error ? (
            <View className="rounded-md border border-app-danger/30 bg-app-danger-soft px-4 py-3 mb-4">
              <Text
                className="text-[13px] text-app-fg"
                style={{ fontFamily: "Manrope" }}
              >
                {error}
              </Text>
            </View>
          ) : null}

          <Hero
            name={fullNameOf(user?.firstName, user?.lastName)}
            stats={data?.stats}
          />

          <StatsGrid
            stats={data?.stats}
            boardCount={boardCount}
            unreadCount={unread.totalUnread}
          />

          <TodaysBoard board={data?.todaysBoard ?? []} />

          {/* The activity feed is the office admin's audit trail only. */}
          {isPartnerAdmin ? (
            <LiveOverview onOpenBell={() => setBellOpen(true)} />
          ) : null}
        </ScrollView>
      </SafeAreaView>

      <BellSheet visible={bellOpen} onClose={() => setBellOpen(false)} />
    </View>
  );
}

/* ───────── Top bar ───────── */
function TopBar({
  partnerName,
  initials,
  onOpenBell,
}: {
  partnerName: string;
  initials: string;
  onOpenBell: () => void;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
  const { count } = useNotificationCount();
  return (
    <View
      className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center justify-between"
    >
      <View>
        <Text
          className="text-[10px] uppercase text-app-copper-deep"
          style={{
            fontFamily: "DMMono-Medium",
            letterSpacing: 1.8,
          }}
        >
          {today}
        </Text>
        <Text
          className="mt-0.5 text-[18px] font-semibold tracking-tight text-app-ink leading-none"
          style={{ fontFamily: "Crimson-SemiBold" }}
          numberOfLines={1}
        >
          {partnerName}
        </Text>
      </View>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        <View className="relative">
          <Pressable
            onPress={onOpenBell}
            className="h-10 w-10 items-center justify-center rounded-full active:opacity-50"
            style={{ backgroundColor: "rgba(10,17,36,0.05)" }}
            accessibilityLabel={
              count > 0
                ? `Notifications, ${count} pending`
                : "Notifications"
            }
          >
            <Feather name="bell" size={18} color="#0a1124" />
          </Pressable>
          {count > 0 ? (
            <View
              className="absolute -right-0.5 -top-0.5 min-w-[16px] h-[16px] px-1 items-center justify-center rounded-full"
              style={{ backgroundColor: "#c14a37" }}
            >
              <Text
                className="text-[9px] tabular-nums"
                style={{
                  fontFamily: "DMMono-Medium",
                  color: "#f5ebd6",
                  letterSpacing: 0.4,
                }}
              >
                {count > 99 ? "99+" : count}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Profile, off the tab bar and onto the corner it belongs in —
            the advocate's own initials, next to the bell. */}
        <Pressable
          onPress={() => openSection("/(home)/profile")}
          className="h-10 w-10 items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: "#0a1124" }}
          accessibilityRole="button"
          accessibilityLabel="My profile"
        >
          <Text
            className="text-[13px] uppercase"
            style={{ fontFamily: "Crimson-SemiBold", color: "#ddb074" }}
          >
            {initials}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// Two letters for the profile button. A placeholder last name like "—"
// contributes nothing (same rule the greeting uses), and an account with
// no usable name at all gets a mark rather than an empty circle.
function initialsOf(first?: string, last?: string): string {
  const pick = (s?: string) => {
    const ch = (s ?? "").trim().charAt(0);
    return ch && !/[\s.\-–—_]/.test(ch) ? ch.toUpperCase() : "";
  };
  return pick(first) + pick(last) || "·";
}

// Greeting shows the advocate's full name (first + last); a stray placeholder
// last name like "—" is dropped so it never reads "Tejas —".
function fullNameOf(first?: string, last?: string): string {
  const f = (first ?? "").trim();
  const l = (last ?? "").trim();
  const cleanLast = /^[\s.\-–—_]*$/.test(l) ? "" : l;
  return [f, cleanLast].filter(Boolean).join(" ") || "Counsel";
}

/* ───────── Hero greeting card ───────── */
function Hero({
  name,
  stats,
}: {
  name: string;
  stats?: PartnerDashboardData["stats"];
}) {
  const hour = new Date().getHours();
  const greeting =
    hour < 5
      ? "Late night"
      : hour < 12
        ? "Good morning"
        : hour < 17
          ? "Good afternoon"
          : "Good evening";
  const today = new Date()
    .toLocaleDateString("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
    .toUpperCase();

  const todayCount = stats?.todayHearings ?? 0;
  const pendingCount = stats?.pendingDates ?? 0;

  return (
    <Animated.View
      entering={FadeInDown.duration(700).springify().damping(14)}
      className="relative overflow-hidden rounded-2xl px-5 py-5"
      style={{
        backgroundColor: "#0a1124",
        shadowColor: "#0a1124",
        shadowOpacity: 0.2,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
      }}
    >
      {/* Brand mark, top-right corner */}
      <View
        pointerEvents="none"
        style={{ position: "absolute", right: 4, top: 8, opacity: 0.7 }}
      >
        <Image
          source={require("../../assets/logo.png")}
          style={{ width: 30, height: 63 }}
          resizeMode="contain"
          tintColor="#ffffff"
        />
      </View>

      <Text
        className="text-[10px] uppercase text-app-copper-bright"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 2.5 }}
      >
        {today}
      </Text>

      <Text
        className="mt-3 text-[26px] font-semibold leading-[1.08] tracking-tight text-app-ivory"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        {greeting},
      </Text>
      {/* The name reads in the same cream as the greeting above it — one
          line, one colour. It used to break to copper mid-sentence. The
          italic is what distinguishes it now. */}
      <Text
        className="text-[26px] leading-[1.1] tracking-tight text-app-ivory"
        style={{
          fontFamily: "Crimson-SemiBoldItalic",
          fontStyle: "italic",
        }}
      >
        {name}.
      </Text>

      <Text
        className="mt-3 text-[13px] leading-[20px] text-app-ivory-soft"
        style={{ fontFamily: "Manrope" }}
      >
        {todayCount === 0 && pendingCount === 0 ? (
          "A clear desk today. The perfect moment to add new matters or attend to long-term work."
        ) : (
          <>
            You have{" "}
            <Text
              className="font-semibold tabular-nums"
              style={{
                fontFamily: "Crimson-SemiBold",
                color: "#ddb074",
                fontSize: 14,
              }}
            >
              {todayCount}
            </Text>{" "}
            {todayCount === 1 ? "hearing" : "hearings"} today
            {pendingCount > 0 ? (
              <>
                {" "}and{" "}
                <Text
                  className="font-semibold tabular-nums"
                  style={{
                    fontFamily: "Crimson-SemiBold",
                    color: "#ddb074",
                    fontSize: 14,
                  }}
                >
                  {pendingCount}
                </Text>{" "}
                {pendingCount === 1 ? "matter" : "matters"} awaiting next date
              </>
            ) : null}
            .
          </>
        )}
      </Text>
    </Animated.View>
  );
}

/* ───────── Stats grid (2x2) ───────── */
function StatsGrid({
  stats,
  boardCount,
  unreadCount,
}: {
  stats?: PartnerDashboardData["stats"];
  boardCount: number;
  unreadCount: number;
}) {
  const router = useRouter();
  const { features } = useAuth();
  const items: Array<{
    label: string;
    // Omitted for a tile whose number isn't a piece of work to do.
    value?: number;
    variant: "copper" | "ink" | "paper";
    icon: keyof typeof Feather.glyphMap;
    href: string;
    feature: FeatureKey;
  }> = [
    {
      label: "Today",
      feature: "hearings",
      value: stats?.todayHearings ?? 0,
      variant: "copper",
      icon: "calendar",
      href: "/(home)/hearings",
    },
    {
      label: "Tomorrow",
      feature: "hearings",
      value: stats?.tomorrowHearings ?? 0,
      variant: "ink",
      icon: "calendar",
      href: "/(home)/hearings?bucket=tomorrow",
    },
    {
      label: "Work Flow",
      feature: "workflow",
      value: boardCount,
      variant: "ink",
      icon: "trello",
      href: "/(home)/workflow",
    },
    {
      label: "Senior Desk",
      feature: "seniorDesk",
      value: unreadCount,
      variant: "paper",
      icon: "message-square",
      href: "/(home)/senior-desk",
    },
    {
      label: "Pending",
      feature: "hearings",
      value: stats?.pendingDates ?? 0,
      variant: "copper",
      icon: "alert-triangle",
      href: "/(home)/hearings?bucket=pending",
    },
    {
      // No count. Every other tile is a number you act on today —
      // hearings to attend, dates to fix, cards to move. "How many
      // matters has this office ever opened" isn't work, and chambers
      // asked for it gone; the vault's own header still carries the
      // total for anyone who wants it.
      label: "Case Vault",
      feature: "cases",
      variant: "paper",
      icon: "briefcase",
      href: "/(home)/cases",
    },
  ];

  // A tile that leads somewhere this chambers can't go would just be a
  // dead end — the screen redirects and the API 403s.
  const visible = items.filter((it) => isFeatureEnabled(features, it.feature));
  if (visible.length === 0) return null;

  return (
    <View className="mt-6 flex-row flex-wrap gap-3">
      {visible.map((it, i) => (
        <Animated.View
          key={it.label}
          entering={FadeInDown.duration(500).delay(80 + i * 60)}
          // flexBasis under 50% leaves room for the 12px gap, flexGrow
          // stretches the pair back to the full row — a true 2-up grid
          // on any phone width (4-up never wraps oddly on tablets).
          style={{ flexGrow: 1, flexBasis: "44%" }}
        >
          <StatCard {...it} onPress={() => openSection(it.href as never)} />
        </Animated.View>
      ))}
    </View>
  );
}

function StatCard({
  label,
  value,
  variant,
  icon,
  onPress,
}: {
  label: string;
  /** Absent = a tile that's a doorway, not a count. */
  value?: number;
  variant: "copper" | "ink" | "paper";
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
}) {
  const styles = {
    copper: {
      bg: "#c5853a",
      text: "#2a1c08",
      label: "#2a1c08",
      iconBg: "rgba(0,0,0,0.12)",
      iconColor: "#2a1c08",
    },
    ink: {
      bg: "#0a1124",
      text: "#f5ebd6",
      label: "#ddb074",
      iconBg: "rgba(255,255,255,0.07)",
      iconColor: "#ddb074",
    },
    paper: {
      bg: "#ffffff",
      text: "#0a1124",
      label: "#7a7060",
      iconBg: "#efe5d0",
      iconColor: "#8a5821",
    },
  }[variant];

  const hasValue = typeof value === "number";

  return (
    <Pressable
      onPress={onPress}
      className="rounded-xl p-5 active:opacity-90"
      style={{
        // Fixed floor so a tile without a number sits level with the
        // ones that have one.
        minHeight: 132,
        backgroundColor: styles.bg,
        shadowColor: "#0a1124",
        shadowOpacity: variant === "paper" ? 0.04 : 0.18,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: variant === "paper" ? 1 : 4,
      }}
    >
      <View
        className="h-8 w-8 items-center justify-center rounded-md"
        style={{ backgroundColor: styles.iconBg }}
      >
        <Feather name={icon} size={14} color={styles.iconColor} />
      </View>
      {hasValue ? (
        <>
          <Text
            className="mt-4 text-[36px] leading-none tracking-tight tabular-nums"
            style={{ fontFamily: "Crimson-SemiBold", color: styles.text }}
          >
            {value}
          </Text>
          <Text
            className="mt-2 text-[10px] uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.6,
              color: styles.label,
            }}
          >
            {label}
          </Text>
        </>
      ) : (
        // Countless tile: the name takes the line the number would have
        // had, so the grid keeps its rhythm instead of leaving a hole.
        <>
          <Text
            className="mt-4 text-[26px] leading-[1.05] tracking-tight"
            style={{ fontFamily: "Crimson-SemiBold", color: styles.text }}
          >
            {label}
          </Text>
          <View className="mt-2 flex-row items-center" style={{ gap: 4 }}>
            <Text
              className="text-[10px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.6,
                color: styles.label,
              }}
            >
              Open
            </Text>
            <Feather name="arrow-right" size={11} color={styles.label} />
          </View>
        </>
      )}
    </Pressable>
  );
}

/* ───────── Today's Board ───────── */
function TodaysBoard({
  board,
}: {
  board: PartnerDashboardData["todaysBoard"];
}) {
  const router = useRouter();
  return (
    <Animated.View entering={FadeInDown.duration(700).delay(420)} className="mt-7">
      <View className="flex-row items-baseline justify-between mb-3">
        <Text
          className="text-[24px] font-semibold tracking-tight text-app-ink"
          style={{ fontFamily: "Crimson-SemiBold" }}
        >
          Today&rsquo;s Board
        </Text>
        <Pressable
          onPress={() => openSection("/(home)/hearings?bucket=today")}
          hitSlop={6}
          className="active:opacity-50"
        >
          <Text
            className="text-[12px] font-medium text-app-copper-deep"
            style={{ fontFamily: "Manrope-Medium" }}
          >
            View all →
          </Text>
        </Pressable>
      </View>

      {board.length === 0 ? (
        <EmptyBoard />
      ) : (
        <View className="gap-3">
          {board.map((c) => (
            <BoardRow key={c.id} c={c} />
          ))}
        </View>
      )}
    </Animated.View>
  );
}

function BoardRow({
  c,
}: {
  c: PartnerDashboardData["todaysBoard"][0];
}) {
  const router = useRouter();
  const next = c.nextHearingDate ? new Date(c.nextHearingDate) : null;
  const isToday =
    next && next.toDateString() === new Date().toDateString();

  return (
    <Pressable
      // Say where this came from, so backing out of the dossier returns
      // to the dashboard rather than stranding the reader in the vault.
      onPress={() => router.push(caseHref(c.id, "home") as never)}
      className="rounded-xl bg-app-paper p-4 active:opacity-90"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: "#c5853a",
      }}
    >
      <View className="flex-row items-baseline gap-2 flex-wrap">
        <Text
          className="text-[17px] font-semibold tracking-tight text-app-ink"
          style={{ fontFamily: "Crimson-SemiBold" }}
        >
          {c.caseNo}
        </Text>
        {c.status ? (
          <View
            className="rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: "#d2e6e7" }}
          >
            <Text
              className="text-[9px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.2,
                color: "#56a0a8",
              }}
            >
              {c.status}
            </Text>
          </View>
        ) : null}
        {isToday ? (
          <View
            className="rounded-md px-1.5 py-0.5"
            style={{ backgroundColor: "rgba(197,133,58,0.18)" }}
          >
            <Text
              className="text-[9px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.2,
                color: "#8a5821",
              }}
            >
              Today
            </Text>
          </View>
        ) : null}
      </View>
      {(c.clientName || c.courtName) && (
        <Text
          className="mt-1.5 text-[12px] text-app-fg-soft"
          style={{ fontFamily: "Manrope" }}
        >
          {c.clientName ? (
            <Text style={{ fontFamily: "Manrope-Medium" }}>{c.clientName}</Text>
          ) : null}
          {c.clientName && (c.courtName || c.courtPlace) ? " · " : ""}
          {[c.courtName, c.courtPlace].filter(Boolean).join(", ")}
        </Text>
      )}
    </Pressable>
  );
}

function EmptyBoard() {
  const router = useRouter();
  return (
    <View
      className="rounded-xl px-5 py-9 items-center"
      style={{
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: "#e3d9c0",
      }}
    >
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Feather name="briefcase" size={20} color="#8a5821" />
      </View>
      <Text
        className="mt-4 text-[20px] font-semibold tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        Nothing on the board yet.
      </Text>
      <Text
        className="mt-1.5 text-[12px] text-app-fg-muted text-center max-w-[280px]"
        style={{ fontFamily: "Manrope" }}
      >
        Add cases with a next hearing date to see them line up here in
        chronological order.
      </Text>
      <Pressable
        onPress={() => router.push("/(home)/cases/new")}
        className="mt-5 rounded-md flex-row items-center gap-2 px-5 py-2.5 active:opacity-90"
        style={{
          backgroundColor: "#0a1124",
          shadowColor: "#0a1124",
          shadowOpacity: 0.2,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Feather name="plus" size={14} color="#f5ebd6" />
        <Text
          className="text-[13px] font-semibold text-app-ivory"
          style={{ fontFamily: "Manrope-SemiBold" }}
        >
          Add the first case
        </Text>
      </Pressable>
    </View>
  );
}
