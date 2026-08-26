import { View, Text, Pressable } from "react-native";
import KeyboardAwareScreen from "../../components/KeyboardAwareScreen";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter, Link } from "expo-router";
import { useState } from "react";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import UnderlineField from "../../components/UnderlineField";
import PrimaryButton from "../../components/PrimaryButton";
import { ApiError } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function SignIn() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);

    if (!email.trim() || !password) {
      setError("Email and password, please.");
      return;
    }

    setSubmitting(true);
    try {
      // login() in AuthContext both persists the token AND refreshes the
      // session so the dashboard router sees an authenticated state
      // immediately. Without that refresh the router would briefly see
      // status="guest" and bounce us right back to signin.
      await login(email.trim(), password);
      router.replace("/dashboard");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : "Something went wrong. Try again.";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-paper">
      <StatusBar style="dark" backgroundColor="#f4ecda" />
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <KeyboardAwareScreen contentContainerClassName="grow pb-12">
            {/* Masthead */}
            <View className="border-b border-rule/40 px-5 py-2.5">
              <View className="flex-row items-center justify-between">
                <Text
                  className="font-mono text-[10px] uppercase text-brass-deep"
                  style={{ letterSpacing: 3 }}
                >
                  Vol. I · No. 01
                </Text>
                <Text
                  className="font-mono text-[10px] uppercase text-ink-soft"
                  style={{ letterSpacing: 3 }}
                >
                  Private Wing
                </Text>
              </View>
            </View>

            {/* Back */}
            <View className="px-5 pt-4">
              <Pressable
                onPress={() => router.back()}
                hitSlop={8}
                className="flex-row items-center gap-2 self-start active:opacity-50"
              >
                <Text className="text-ink text-[16px]">←</Text>
                <Text
                  className="font-mono text-[10px] uppercase text-ink-soft"
                  style={{ letterSpacing: 2.5 }}
                >
                  Back
                </Text>
              </Pressable>
            </View>

            {/* Hero */}
            <View className="px-5 pt-6">
              <Animated.View
                entering={FadeInDown.duration(600).delay(50)}
                className="flex-row items-center gap-3"
              >
                <View className="h-px w-7 bg-brass" />
                <Text
                  className="font-mono text-[10px] uppercase text-brass-deep"
                  style={{ letterSpacing: 3 }}
                >
                  Private Wing — § VII
                </Text>
              </Animated.View>

              <Animated.Text
                entering={FadeInDown.duration(600).delay(150)}
                className="mt-5 font-display text-[44px] leading-[1.04] tracking-tight text-ink"
              >
                Open
              </Animated.Text>
              <Animated.Text
                entering={FadeInDown.duration(600).delay(200)}
                className="font-display-italic text-[44px] leading-[1.04] tracking-tight text-ink-2"
              >
                the file.
              </Animated.Text>

              <Animated.Text
                entering={FadeInDown.duration(600).delay(280)}
                className="mt-5 font-body text-[16px] leading-[26px] text-ink-2"
              >
                Welcome back to chambers. Sign in to pick up where the day left
                you — pending dates, the cause-list, your senior-desk notes.
              </Animated.Text>

              {/* Form */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(380)}
                className="mt-9 gap-7"
              >
                <UnderlineField
                  index="01"
                  label="Office Email"
                  type="email"
                  value={email}
                  onChangeText={setEmail}
                  placeholder="advocate@chambers.in"
                  required
                />
                <UnderlineField
                  index="02"
                  label="Password"
                  type="password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  required
                  rightSlot={
                    <Link href="/forgot-password" asChild>
                      <Pressable hitSlop={6}>
                        <Text
                          className="font-mono text-[9px] uppercase text-brass-deep"
                          style={{ letterSpacing: 2 }}
                        >
                          Forgot?
                        </Text>
                      </Pressable>
                    </Link>
                  }
                />

                {/* Remember me */}
                <Pressable
                  onPress={() => setRemember((s) => !s)}
                  className="flex-row items-center gap-3 self-start"
                  hitSlop={6}
                >
                  <View
                    className={
                      remember
                        ? "h-4 w-4 border border-ink bg-ink items-center justify-center"
                        : "h-4 w-4 border border-ink/40 items-center justify-center"
                    }
                  >
                    {remember ? (
                      <Text className="text-paper text-[10px] leading-none">
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <Text
                    className="font-mono text-[11px] uppercase text-ink-2"
                    style={{ letterSpacing: 2 }}
                  >
                    Remember this device
                  </Text>
                </Pressable>
              </Animated.View>

              {/* Error */}
              {error ? (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  className="mt-6 border border-vermillion/40 bg-vermillion/5 px-4 py-3"
                >
                  <Text
                    className="font-mono text-[10px] uppercase text-vermillion"
                    style={{ letterSpacing: 2.5 }}
                  >
                    Notice from the bench
                  </Text>
                  <Text className="mt-1.5 font-body-italic text-[13px] leading-5 text-ink-2">
                    {error}
                  </Text>
                </Animated.View>
              ) : null}

              {/* Submit */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(500)}
                className="mt-8"
              >
                <PrimaryButton
                  label={submitting ? "Authenticating…" : "Sign In"}
                  onPress={onSubmit}
                  loading={submitting}
                />
              </Animated.View>

              {/* Footnote */}
              <Animated.View
                entering={FadeIn.duration(600).delay(650)}
                className="mt-10 border-t border-rule/40 pt-5"
              >
                <Text className="font-body-italic text-[13px] leading-5 text-ink-soft">
                  Need access? Speak to your office&rsquo;s administrator. New
                  chambers are added by invitation —{" "}
                  <Text
                    className="font-mono text-[11px] uppercase text-ink"
                    style={{ letterSpacing: 2 }}
                  >
                    chambers@legalezi.com
                  </Text>
                  .
                </Text>
              </Animated.View>
            </View>
        </KeyboardAwareScreen>
      </SafeAreaView>
    </View>
  );
}
