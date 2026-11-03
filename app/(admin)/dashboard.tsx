import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { openSection } from "../../lib/navigation";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import {
  adminDashboard,
  logout,
  type DashboardData,
} from "../../lib/api";

export default function AdminDashboard() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await adminDashboard();
      setData(d);
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function onSignOut() {
    await logout();
    router.replace("/");
  }

  if (loading) {
    return (
      <View className="flex-1 bg-admin-bg items-center justify-center">
        <ActivityIndicator color="#0e7c4a" size="large" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-admin-bg">
      <StatusBar style="dark" backgroundColor="#fafaf7" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar onSignOut={onSignOut} adminName={data?.adminName ?? "Global"} />
        <ScrollView
          contentContainerClassName="pb-8"
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#0e7c4a"
            />
          }
        >
          {error ? (
            <View className="mx-5 mt-5 rounded-md border border-admin-danger/30 bg-admin-danger-soft px-4 py-3">
              <Text className="font-plex text-[13px] text-admin-fg">
                {error}
              </Text>
            </View>
          ) : null}

          <Greeting adminName={data?.adminName ?? "Global"} />

          {data ? <StatsGrid stats={data.stats} /> : null}

          <QuickActions />

          {data ? <RecentPartners partners={data.recentPartners} /> : null}

          <TipCard />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/* ───────── Top bar ───────── */
function TopBar({
  adminName,
  onSignOut,
}: {
  adminName: string;
  onSignOut: () => void;
}) {
  return (
    <View className="bg-admin-surface border-b border-admin-border">
      {/* emerald rule */}
      <View className="h-[2px] bg-admin-accent" />
      <View className="px-5 py-3.5 flex-row items-center justify-between">
        <View>
          <Text
            className="font-plex-mono-medium text-[10px] uppercase text-admin-accent"
            style={{ letterSpacing: 1.8 }}
          >
            Legaleezi · Admin
          </Text>
          <Text className="mt-0.5 font-plex-bold text-[18px] text-admin-fg">
            Dashboard
          </Text>
        </View>
        <Pressable
          onPress={onSignOut}
          hitSlop={8}
          className="flex-row items-center gap-1.5 active:opacity-50"
        >
          <Text className="font-plex text-[12px] text-admin-fg-muted">
            {adminName.split(" ")[0]}
          </Text>
          <Feather name="log-out" size={14} color="#5a6470" />
        </Pressable>
      </View>
    </View>
  );
}

/* ───────── Greeting ───────── */
function Greeting({ adminName }: { adminName: string }) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return (
    <Animated.View
      entering={FadeInDown.duration(500)}
      className="px-5 pt-7"
    >
      <Text
        className="font-plex-mono-medium text-[10px] uppercase text-admin-accent"
        style={{ letterSpacing: 1.8 }}
      >
        Overview
      </Text>
      <Text className="mt-2 font-plex-bold text-[28px] tracking-tight text-admin-fg leading-tight">
        Welcome back,{"\n"}
        {adminName.split(" ")[0]}.
      </Text>
      <Text
        className="mt-2 font-plex-mono text-[11px] text-admin-fg-soft"
        style={{ letterSpacing: 0.5 }}
      >
        {today}
      </Text>
    </Animated.View>
  );
}

/* ───────── Stats grid ───────── */
function StatsGrid({
  stats,
}: {
  stats: DashboardData["stats"];
}) {
  return (
    <View className="px-5 mt-7 flex-row flex-wrap gap-3">
      <StatCard
        label="Total Partners"
        value={stats.totalPartners}
        sublabel={`${stats.activePartners} active · ${stats.trialPartners} trial`}
        icon="users"
        accent="emerald"
        delay={50}
      />
      <StatCard
        label="Active Subs"
        value={stats.activePartners}
        sublabel={
          stats.totalPartners
            ? `${Math.round((stats.activePartners / stats.totalPartners) * 100)}% of partners`
            : "no partners yet"
        }
        icon="check-circle"
        accent="emerald"
        delay={100}
      />
      <StatCard
        label="On Trial"
        value={stats.trialPartners}
        sublabel="convert before expiry"
        icon="clock"
        accent="saffron"
        delay={150}
      />
      <StatCard
        label="Total Users"
        value={stats.totalUsers}
        sublabel="across all chambers"
        icon="user"
        accent="neutral"
        delay={200}
      />
    </View>
  );
}

function StatCard({
  label,
  value,
  sublabel,
  icon,
  accent,
  delay,
}: {
  label: string;
  value: number | string;
  sublabel: string;
  icon: keyof typeof Feather.glyphMap;
  accent: "emerald" | "saffron" | "neutral";
  delay: number;
}) {
  const bg =
    accent === "emerald"
      ? "bg-admin-accent-soft"
      : accent === "saffron"
        ? "bg-admin-saffron-soft"
        : "bg-admin-border-soft";
  const fg =
    accent === "emerald"
      ? "#0e7c4a"
      : accent === "saffron"
        ? "#e5803a"
        : "#5a6470";
  return (
    <Animated.View
      entering={FadeInDown.duration(500).delay(delay)}
      className="bg-admin-surface border border-admin-border rounded-lg p-4"
      style={{ width: "47.5%" }}
    >
      <View className="flex-row items-start justify-between">
        <Text
          className="font-plex-mono-medium text-[9px] uppercase text-admin-fg-soft"
          style={{ letterSpacing: 1.5 }}
        >
          {label}
        </Text>
        <View
          className={`h-7 w-7 rounded-md items-center justify-center ${bg}`}
        >
          <Feather name={icon} size={13} color={fg} />
        </View>
      </View>
      <Text
        className="mt-3 font-plex-bold text-[32px] text-admin-fg tabular-nums leading-none"
      >
        {value}
      </Text>
      <Text className="mt-1.5 font-plex text-[11px] text-admin-fg-muted">
        {sublabel}
      </Text>
    </Animated.View>
  );
}

/* ───────── Quick actions ───────── */
function QuickActions() {
  const router = useRouter();
  return (
    <View className="px-5 mt-7">
      <Text
        className="font-plex-mono-medium text-[10px] uppercase text-admin-fg-soft"
        style={{ letterSpacing: 1.8 }}
      >
        Quick actions
      </Text>
      <View className="mt-3 gap-2.5">
        <Pressable
          onPress={() => router.push("/(admin)/partners/new")}
          className="bg-admin-accent active:bg-admin-accent-hover rounded-md px-5 py-3.5 flex-row items-center justify-between"
          style={{
            shadowColor: "#0e7c4a",
            shadowOpacity: 0.18,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          <Text className="font-plex-bold text-[14px] text-white">
            + Add a Partner
          </Text>
          <Feather name="arrow-right" size={16} color="white" />
        </Pressable>
        <Pressable
          onPress={() => openSection("/(admin)/partners")}
          className="bg-admin-surface border border-admin-border active:bg-admin-bg rounded-md px-5 py-3.5 flex-row items-center justify-between"
        >
          <Text className="font-plex-medium text-[14px] text-admin-fg">
            Browse Partners
          </Text>
          <Feather name="arrow-right" size={16} color="#5a6470" />
        </Pressable>
      </View>
    </View>
  );
}

/* ───────── Recent partners ───────── */
function RecentPartners({
  partners,
}: {
  partners: DashboardData["recentPartners"];
}) {
  const router = useRouter();
  return (
    <View className="px-5 mt-9">
      <View className="flex-row items-baseline justify-between">
        <Text
          className="font-plex-mono-medium text-[10px] uppercase text-admin-fg-soft"
          style={{ letterSpacing: 1.8 }}
        >
          Recent Partners
        </Text>
        <Pressable
          onPress={() => openSection("/(admin)/partners")}
          hitSlop={6}
          className="active:opacity-50"
        >
          <Text className="font-plex-medium text-[12px] text-admin-accent">
            View all →
          </Text>
        </Pressable>
      </View>

      {partners.length === 0 ? (
        <View className="mt-3 border border-dashed border-admin-border bg-admin-surface rounded-lg px-5 py-8 items-center">
          <Feather name="users" size={22} color="#0e7c4a" />
          <Text className="mt-3 font-plex-bold text-[15px] text-admin-fg">
            No partners yet
          </Text>
          <Text className="mt-1 font-plex text-[12px] text-admin-fg-muted text-center">
            Add the first chambers to get started.
          </Text>
        </View>
      ) : (
        <View className="mt-3 bg-admin-surface border border-admin-border rounded-lg overflow-hidden">
          {partners.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => router.push(`/(admin)/partners/${p.id}`)}
              className={`px-4 py-3.5 active:bg-admin-bg ${
                i < partners.length - 1 ? "border-b border-admin-border-soft" : ""
              }`}
            >
              <View className="flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <Text className="font-plex-bold text-[14px] text-admin-fg">
                    {p.name}
                  </Text>
                  <Text
                    className="mt-0.5 font-plex-mono text-[10px] text-admin-fg-soft"
                    style={{ letterSpacing: 0.5 }}
                  >
                    {p.primaryEmail}
                  </Text>
                </View>
                <View className="items-end gap-1">
                  <PlanPill plan={p.plan} />
                  <StatusDot status={p.status} />
                </View>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

function PlanPill({ plan }: { plan: string }) {
  const isTrial = plan === "trial";
  return (
    <View
      className={`px-1.5 py-0.5 rounded-sm border ${
        isTrial
          ? "border-admin-saffron/40 bg-admin-saffron-soft"
          : "border-admin-border bg-admin-bg"
      }`}
    >
      <Text
        className={`font-plex-mono-medium text-[8px] uppercase ${
          isTrial ? "text-admin-saffron" : "text-admin-fg-muted"
        }`}
        style={{ letterSpacing: 1.2 }}
      >
        {plan}
      </Text>
    </View>
  );
}

function StatusDot({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "#0e7c4a",
    trial: "#e5803a",
    past_due: "#b7791f",
    cancelled: "#c9382f",
    suspended: "#c9382f",
  };
  const color = map[status] ?? "#8a929e";
  return (
    <View className="flex-row items-center gap-1">
      <View
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      <Text
        className="font-plex-mono text-[9px] uppercase"
        style={{ letterSpacing: 1, color }}
      >
        {status.replace("_", " ")}
      </Text>
    </View>
  );
}

/* ───────── Tip card ───────── */
function TipCard() {
  return (
    <Animated.View
      entering={FadeIn.duration(700).delay(450)}
      className="mx-5 mt-7 bg-admin-accent-soft border border-admin-accent/20 rounded-lg p-4"
    >
      <Text
        className="font-plex-mono-medium text-[9px] uppercase text-admin-accent"
        style={{ letterSpacing: 1.5 }}
      >
        Tip · § 01
      </Text>
      <Text className="mt-2 font-plex text-[13px] leading-[20px] text-admin-fg">
        Trials default to 7 days. You can extend a partner&rsquo;s trial from
        their detail page if they need more time before going active.
      </Text>
    </Animated.View>
  );
}
