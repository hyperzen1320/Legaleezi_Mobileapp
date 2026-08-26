import { ScrollView, View, Text, Pressable, Platform, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect, useRouter } from "expo-router";
import Animated, {
  FadeInDown,
  FadeIn,
  FadeInUp,
} from "react-native-reanimated";
import { useAuth } from "../lib/auth-context";
import BootScreen from "../components/BootScreen";

export default function Home() {
  const { status } = useAuth();

  // Boot order: the native splash covers font loading; if the session
  // probe is still in flight after that (slow network), the animated
  // BootScreen takes over. Signed-in users skip the marketing page
  // entirely and land on their workspace; guests get the landing.
  if (status === "loading") {
    return <BootScreen />;
  }
  if (status === "authenticated") {
    return <Redirect href="/dashboard" />;
  }

  return (
    <View className="flex-1 bg-paper">
      <StatusBar style="dark" backgroundColor="#f4ecda" />
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <TopBar />
        <ScrollView
          className="flex-1"
          contentContainerClassName="pb-6"
          showsVerticalScrollIndicator={false}
        >
          <HeroCard />
          <FeatureStripe />
          <PullQuote />
          <TrustStrip />
        </ScrollView>
        <BottomCTA />
      </SafeAreaView>
    </View>
  );
}

/* ───────── Top bar ───────── */
function TopBar() {
  const router = useRouter();
  return (
    <View>
      <View className="flex-row items-center justify-between px-5 py-3">
        <View className="flex-row items-center gap-2.5">
          <BrandMark />
          <Text className="font-display text-[19px] tracking-tight text-ink leading-none">
            Legalezi
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/signin")}
          hitSlop={10}
          className="active:opacity-50 flex-row items-center gap-1"
        >
          <Text className="font-body text-[14px] text-ink-2">Sign in</Text>
          <Text className="text-brass text-[14px]">→</Text>
        </Pressable>
      </View>
      <View className="h-px bg-rule/30 mx-5" />
    </View>
  );
}

function BrandMark() {
  return (
    <Image
      source={require("../assets/logo.png")}
      style={{ height: 28, width: 16, resizeMode: "contain" }}
    />
  );
}

/* ───────── Hero card ───────── */
function HeroCard() {
  return (
    <View className="px-5 pt-7">
      <Animated.View
        entering={FadeInDown.duration(750).springify().damping(14)}
        className="relative bg-paper-2/30 border border-rule/40 px-6 pt-8 pb-7"
        style={{
          shadowColor: "#0e1a2b",
          shadowOpacity: 0.07,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 5,
        }}
      >
        {/* Corner marks — top */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <View className="h-px w-5 bg-brass" />
            <Text
              className="font-mono text-[10px] uppercase text-brass-deep"
              style={{ letterSpacing: 2.5 }}
            >
              § I
            </Text>
          </View>
          <Text
            className="font-mono text-[9px] uppercase text-ink-soft"
            style={{ letterSpacing: 2.5 }}
          >
            For the Indian Bar
          </Text>
        </View>

        {/* Statement — two lines, italic */}
        <Animated.Text
          entering={FadeInDown.duration(700).delay(150).springify().damping(14)}
          className="mt-9 font-display-italic text-[40px] leading-[1.06] tracking-tight text-ink"
        >
          Your office,
        </Animated.Text>
        <Animated.Text
          entering={FadeInDown.duration(700).delay(230).springify().damping(14)}
          className="font-display-italic text-[40px] leading-[1.06] tracking-tight text-ink"
        >
          in your pocket.
        </Animated.Text>

        {/* Brass rule */}
        <Animated.View
          entering={FadeIn.duration(700).delay(420)}
          className="mt-7 h-[2px] w-14 bg-brass"
        />

        {/* Subtitle */}
        <Animated.Text
          entering={FadeInDown.duration(700).delay(330).springify().damping(14)}
          className="mt-5 font-body text-[15px] leading-[24px] text-ink-2"
        >
          Cause-list at dawn. Cases at noon. Senior-desk briefings before tea — the advocate office, kept on glass.
        </Animated.Text>

        {/* Vermillion seal — top-right corner */}
        <Animated.View
          entering={FadeIn.duration(700).delay(550)}
          className="absolute -right-2 -top-2 h-12 w-12 rounded-full border border-vermillion/60 bg-paper rotate-12 items-center justify-center"
        >
          <Text
            className="font-mono text-[7px] uppercase text-vermillion text-center"
            style={{ letterSpacing: 1.5 }}
          >
            BETA{"\n"}MMXXVI
          </Text>
        </Animated.View>

        {/* Foot meta */}
        <Animated.View
          entering={FadeIn.duration(700).delay(620)}
          className="mt-8 flex-row items-center justify-between border-t border-rule/40 pt-3.5"
        >
          <Text
            className="font-mono text-[9px] uppercase text-ink-soft"
            style={{ letterSpacing: 2.5 }}
          >
            Vol. I · No. 01
          </Text>
          <Text
            className="font-mono text-[9px] uppercase text-ink-soft"
            style={{ letterSpacing: 2.5 }}
          >
            Made in India
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

/* ───────── Feature stripe (horizontal scroll) ───────── */
function FeatureStripe() {
  const features: { glyph: string; title: string; desc: string }[] = [
    {
      glyph: "§",
      title: "Case Vault",
      desc: "File no., CNR, IAs, hearings — kept.",
    },
    {
      glyph: "◆",
      title: "Today's List",
      desc: "The morning's cause-list, court-wise.",
    },
    {
      glyph: "✦",
      title: "Pending Dates",
      desc: "Catch them before the Bench does.",
    },
    {
      glyph: "❖",
      title: "Senior Desk",
      desc: "Reminders to your juniors, in chambers.",
    },
  ];

  return (
    <Animated.View
      entering={FadeInDown.duration(700).delay(750)}
      className="mt-10"
    >
      <View className="px-5 mb-4">
        <View className="flex-row items-center gap-2">
          <View className="h-px w-4 bg-brass" />
          <Text
            className="font-mono text-[10px] uppercase text-brass-deep"
            style={{ letterSpacing: 2.5 }}
          >
            What&rsquo;s inside
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={224}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
      >
        {features.map((f, i) => (
          <View
            key={i}
            className="w-52 bg-paper-2/40 border border-rule/40 px-5 py-5"
            style={{
              shadowColor: "#0e1a2b",
              shadowOpacity: 0.04,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 2 },
              elevation: 1,
            }}
          >
            <View className="flex-row items-center justify-between">
              <Text className="font-display-bold text-brass text-[28px] leading-none">
                {f.glyph}
              </Text>
              <Text
                className="font-mono text-[9px] uppercase text-ink-soft"
                style={{ letterSpacing: 2 }}
              >
                {String(i + 1).padStart(2, "0")}
              </Text>
            </View>
            <Text className="mt-4 font-display text-[18px] tracking-tight text-ink leading-tight">
              {f.title}
            </Text>
            <Text className="mt-1.5 font-body text-[13px] leading-[20px] text-ink-soft">
              {f.desc}
            </Text>
          </View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/* ───────── Pull quote ───────── */
function PullQuote() {
  return (
    <Animated.View
      entering={FadeIn.duration(800).delay(900)}
      className="mt-12 px-7"
    >
      <View className="flex-row gap-4">
        <View className="w-[2px] bg-brass" />
        <View className="flex-1">
          <Text className="font-display-italic text-[20px] leading-[1.4] tracking-tight text-ink-2">
            &ldquo;Every file remembers{" "}
            <Text className="text-ink">what we forget.</Text>&rdquo;
          </Text>
          <Text
            className="mt-3 font-mono text-[10px] uppercase text-ink-soft"
            style={{ letterSpacing: 2 }}
          >
            <Text className="text-brass-deep">¶</Text>  Anon. circular, City Civil · 1979
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

/* ───────── Trust strip ───────── */
function TrustStrip() {
  return (
    <Animated.View
      entering={FadeIn.duration(700).delay(1000)}
      className="mt-12 mx-5 border-y border-rule/40 py-3.5 flex-row items-center justify-between"
    >
      <View className="flex-row items-center gap-2">
        <Text className="text-brass text-[11px]">★★★★★</Text>
        <Text
          className="font-mono text-[10px] uppercase text-ink-soft"
          style={{ letterSpacing: 2 }}
        >
          4.9
        </Text>
      </View>
      <Text
        className="font-mono text-[10px] uppercase text-ink-soft"
        style={{ letterSpacing: 2 }}
      >
        200+ advocates · iOS · Android
      </Text>
    </Animated.View>
  );
}

/* ───────── Bottom CTA (sticky) ───────── */
function BottomCTA() {
  const router = useRouter();
  return (
    <Animated.View
      entering={FadeInUp.duration(700).delay(400)}
      className="border-t border-rule/40 bg-paper px-5 pt-3 pb-3"
      style={{
        shadowColor: "#0e1a2b",
        shadowOpacity: 0.06,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: -4 },
        elevation: 8,
        ...(Platform.OS === "android" ? { paddingBottom: 6 } : {}),
      }}
    >
      <Pressable
        onPress={() => router.push("/signup")}
        className="bg-ink active:bg-ink-2 py-4 px-6 flex-row items-center justify-center gap-3"
        style={{
          shadowColor: "#0e1a2b",
          shadowOpacity: 0.15,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Text
          className="font-mono text-[12px] uppercase text-paper"
          style={{ letterSpacing: 2.5 }}
        >
          Begin a Chambers
        </Text>
        <Text className="text-brass text-[14px]">→</Text>
      </Pressable>

      <View className="mt-3 flex-row items-center justify-center gap-2">
        <Text className="font-body-italic text-[13px] text-ink-soft">
          Already in chambers?
        </Text>
        <Pressable
          onPress={() => router.push("/signin")}
          hitSlop={6}
          className="active:opacity-50"
        >
          <Text
            className="font-mono text-[11px] uppercase text-ink"
            style={{ letterSpacing: 1.5 }}
          >
            Sign in →
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
