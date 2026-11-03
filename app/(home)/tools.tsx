import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";

// Tools — a home for handy practice utilities curated by the Legaleezi team.
// The tool set is managed centrally (global admin) and will populate here;
// this is the shell reachable from More → Tools.
export default function Tools() {
  const router = useRouter();

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Top bar */}
        <View
          className="border-b border-app-edge bg-app-canvas px-4 py-3 flex-row items-center"
          style={{ gap: 10 }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
            style={{ backgroundColor: "#ffffff" }}
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={17} color="#0a1124" />
          </Pressable>
          <View>
            <Text
              className="text-[10px] uppercase text-app-copper-deep"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
            >
              Practice
            </Text>
            <Text
              className="text-[18px] tracking-tight text-app-ink leading-none"
              style={{ fontFamily: "Crimson-SemiBold" }}
            >
              Tools
            </Text>
          </View>
        </View>

        {/* Empty state — the shell. */}
        <View className="flex-1 items-center justify-center px-8">
          <View
            className="h-16 w-16 items-center justify-center rounded-2xl"
            style={{ backgroundColor: "#efe5d0" }}
          >
            <Feather name="tool" size={26} color="#8a5821" />
          </View>
          <Text
            className="mt-5 text-[22px] tracking-tight text-app-ink text-center"
            style={{ fontFamily: "Crimson-SemiBold" }}
          >
            Tools are on the way.
          </Text>
          <Text
            className="mt-2 text-[13px] text-app-fg-muted text-center"
            style={{ fontFamily: "Manrope", lineHeight: 20 }}
          >
            Handy utilities for your practice will appear here, curated by the
            Legaleezi team.
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}
