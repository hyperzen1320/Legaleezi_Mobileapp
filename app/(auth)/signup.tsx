import { useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter, Link } from "expo-router";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import UnderlineField from "../../components/UnderlineField";
import PrimaryButton from "../../components/PrimaryButton";
import { ApiError, signupStart, signupVerify } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

// Open a chambers on the free trial:
//
//   details  →  six-digit code  →  chambers created  →  signed in
//
// Step 1 writes NOTHING. The chambers details and a hash of the chosen
// password ride along inside the one-time-code record and are only spent
// once the address proves itself — so an abandoned or fake sign-up leaves
// nothing behind for the Legaleezi desk to clean up. Step 2 is what
// creates the chambers, and it lands straight in the app.

const CODE_LENGTH = 6;
const TRIAL_DAYS = 7;

type Step = "details" | "code";

export default function SignUp() {
  const router = useRouter();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>("details");
  const [contactName, setContactName] = useState("");
  const [chambersName, setChambersName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailTaken, setEmailTaken] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const detailsReady =
    contactName.trim().length > 0 &&
    chambersName.trim().length > 0 &&
    /^\S+@\S+\.\S+$/.test(email.trim()) &&
    phone.replace(/\D/g, "").length >= 8 &&
    password.length >= 8;

  async function startSignup(resend = false) {
    setError(null);
    setEmailTaken(false);
    setNote(null);
    if (!detailsReady) {
      setError(
        "We need your name, your chambers, a valid email, a phone number and a password of at least 8 characters."
      );
      return;
    }
    setBusy(true);
    try {
      const res = await signupStart({
        chambersName: chambersName.trim(),
        contactName: contactName.trim(),
        phone: phone.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      setCooldown(res.retryAfterSeconds ?? 60);
      setStep("code");
      setNote(
        resend
          ? "A fresh code is on its way."
          : `We've emailed a six-digit code to ${email.trim().toLowerCase()}.`
      );
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setEmailTaken(err.body?.code === "email_taken");
        const retry = err.body?.retryAfterSeconds;
        if (typeof retry === "number") setCooldown(retry);
      } else {
        setError("Couldn't start that sign-up. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndEnter() {
    setError(null);
    setNote(null);
    setBusy(true);
    try {
      await signupVerify(email.trim().toLowerCase(), code.trim());
      // The chambers exists and we still hold the password they chose —
      // walk them in rather than asking them to sign in immediately after
      // signing up. If that trips, the account IS created, so send them
      // to Sign In rather than leaving them stranded here.
      try {
        await login(email.trim().toLowerCase(), password);
        router.replace("/dashboard");
      } catch {
        router.replace("/signin");
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "That code doesn't match."
      );
      setBusy(false);
    }
  }

  function onSubmit() {
    if (busy) return;
    if (step === "details") void startSignup();
    else void verifyAndEnter();
  }

  const canSubmit =
    step === "details"
      ? detailsReady
      : code.replace(/\D/g, "").length === CODE_LENGTH;

  return (
    <View className="flex-1 bg-paper">
      <StatusBar style="dark" backgroundColor="#f4ecda" />
      <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="grow pb-12"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
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
                  {TRIAL_DAYS} Days Free
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
                  Admissions — § VIII
                </Text>
              </Animated.View>

              <Animated.Text
                entering={FadeInDown.duration(600).delay(150)}
                className="mt-5 font-display text-[44px] leading-[1.04] tracking-tight text-ink"
              >
                Open your
              </Animated.Text>
              <Animated.Text
                entering={FadeInDown.duration(600).delay(200)}
                className="font-display-italic text-[44px] leading-[1.04] tracking-tight text-ink-2"
              >
                chambers.
              </Animated.Text>

              <Animated.Text
                entering={FadeInDown.duration(600).delay(280)}
                className="mt-5 font-body text-[16px] leading-[26px] text-ink-2"
              >
                {TRIAL_DAYS} days on the house — the full cabinet, the
                cause-list, the senior desk, your whole office. No card, no
                call, nothing to cancel.
              </Animated.Text>

              <Animated.View
                entering={FadeInDown.duration(600).delay(340)}
                className="mt-8"
              >
                <StepRail step={step} />
              </Animated.View>

              {/* Form */}
              {step === "details" ? (
                <Animated.View
                  entering={FadeInDown.duration(600).delay(380)}
                  className="mt-7 gap-7"
                >
                  <UnderlineField
                    index="01"
                    label="Your Name"
                    type="text"
                    value={contactName}
                    onChangeText={setContactName}
                    placeholder="K S Nagendhran"
                    autoCapitalize="words"
                    required
                  />
                  <UnderlineField
                    index="02"
                    label="Chambers Name"
                    type="text"
                    value={chambersName}
                    onChangeText={setChambersName}
                    placeholder="Nagendhran & Associates"
                    autoCapitalize="words"
                    required
                  />
                  <UnderlineField
                    index="03"
                    label="Office Email"
                    type="email"
                    value={email}
                    onChangeText={setEmail}
                    placeholder="ks@nagendhran.in"
                    required
                  />
                  <UnderlineField
                    index="04"
                    label="Phone"
                    type="phone"
                    value={phone}
                    onChangeText={setPhone}
                    placeholder="+91 98765 43210"
                    required
                  />
                  <UnderlineField
                    index="05"
                    label="Choose a Password"
                    type="password"
                    value={password}
                    onChangeText={setPassword}
                    placeholder="At least 8 characters"
                    required
                  />
                  <Text className="font-body-italic text-[13px] leading-5 text-ink-soft">
                    This becomes the office admin account — you can add the
                    rest of chambers once you&rsquo;re in.
                  </Text>
                </Animated.View>
              ) : (
                <Animated.View
                  entering={FadeInDown.duration(500)}
                  className="mt-7"
                >
                  <View className="flex-row items-baseline justify-between">
                    <Text
                      className="font-mono text-[10px] uppercase text-brass-deep"
                      style={{ letterSpacing: 2.5 }}
                    >
                      <Text className="text-brass">06</Text>  Six-digit code
                    </Text>
                    <Pressable
                      onPress={() => {
                        setStep("details");
                        setCode("");
                        setNote(null);
                        setError(null);
                      }}
                      hitSlop={8}
                      className="active:opacity-50"
                    >
                      <Text
                        className="font-mono text-[10px] uppercase text-ink-soft"
                        style={{ letterSpacing: 2 }}
                      >
                        Edit details
                      </Text>
                    </Pressable>
                  </View>
                  <TextInput
                    value={code}
                    onChangeText={(v) =>
                      setCode(v.replace(/\D/g, "").slice(0, CODE_LENGTH))
                    }
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={CODE_LENGTH}
                    placeholder="••••••"
                    placeholderTextColor="rgba(14,26,43,0.25)"
                    className="mt-3 border-b border-ink/25 pb-2 text-ink"
                    style={{
                      fontFamily: "JetBrainsMono-Medium",
                      fontSize: 28,
                      letterSpacing: 14,
                    }}
                    accessibilityLabel="Six-digit code"
                  />
                  <View className="mt-3 flex-row items-center gap-3">
                    <Pressable
                      onPress={() => void startSignup(true)}
                      disabled={cooldown > 0 || busy}
                      hitSlop={8}
                      className="active:opacity-50"
                    >
                      <Text
                        className="font-mono text-[10px] uppercase"
                        style={{
                          letterSpacing: 2,
                          color:
                            cooldown > 0 || busy
                              ? "rgba(14,26,43,0.35)"
                              : "#8a6a2f",
                        }}
                      >
                        {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                      </Text>
                    </Pressable>
                    <Text className="text-rule">·</Text>
                    <Text
                      className="font-mono text-[10px] uppercase text-ink-soft flex-1"
                      style={{ letterSpacing: 2 }}
                      numberOfLines={1}
                    >
                      {email.trim().toLowerCase()}
                    </Text>
                  </View>
                </Animated.View>
              )}

              {note && !error ? (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  className="mt-6 border border-brass/40 bg-brass/5 px-4 py-3"
                >
                  <Text
                    className="font-mono text-[10px] uppercase text-brass-deep"
                    style={{ letterSpacing: 2.5 }}
                  >
                    ✓  Filed
                  </Text>
                  <Text className="mt-1.5 font-body-italic text-[13px] leading-5 text-ink-2">
                    {note}
                  </Text>
                </Animated.View>
              ) : null}

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
                  {emailTaken ? (
                    <View className="mt-3 flex-row items-center gap-4">
                      <Link href="/signin" asChild>
                        <Pressable hitSlop={6} className="active:opacity-50">
                          <Text
                            className="font-mono text-[10px] uppercase text-ink"
                            style={{ letterSpacing: 2 }}
                          >
                            Sign in
                          </Text>
                        </Pressable>
                      </Link>
                      <Link href="/forgot-password" asChild>
                        <Pressable hitSlop={6} className="active:opacity-50">
                          <Text
                            className="font-mono text-[10px] uppercase text-brass-deep"
                            style={{ letterSpacing: 2 }}
                          >
                            Reset password
                          </Text>
                        </Pressable>
                      </Link>
                    </View>
                  ) : null}
                </Animated.View>
              ) : null}

              {/* Submit */}
              <Animated.View
                entering={FadeInDown.duration(600).delay(500)}
                className="mt-9"
              >
                <PrimaryButton
                  label={
                    step === "details"
                      ? busy
                        ? "Sending code…"
                        : "Email me a code"
                      : busy
                        ? "Opening chambers…"
                        : "Verify & open chambers"
                  }
                  onPress={onSubmit}
                  loading={busy}
                  disabled={!canSubmit}
                />
              </Animated.View>

              {/* Footnote */}
              <Animated.View
                entering={FadeIn.duration(600).delay(650)}
                className="mt-10 border-t border-rule/40 pt-5"
              >
                <View className="flex-row items-baseline gap-2">
                  <Text className="font-body-italic text-[13px] leading-5 text-ink-soft">
                    Already in chambers?
                  </Text>
                  <Link href="/signin" asChild>
                    <Pressable hitSlop={6} className="active:opacity-50">
                      <Text
                        className="font-mono text-[11px] uppercase text-ink"
                        style={{ letterSpacing: 2 }}
                      >
                        Sign in →
                      </Text>
                    </Pressable>
                  </Link>
                </View>
              </Animated.View>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

/* ─── Step rail ─── */

function StepRail({ step }: { step: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "code", label: "Verify" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);

  return (
    <View className="flex-row items-center" style={{ gap: 10 }}>
      {steps.map((s, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        return (
          <View key={s.key} className="flex-row items-center" style={{ gap: 10 }}>
            <Text
              className="font-mono text-[10px] uppercase"
              style={{
                letterSpacing: 2,
                color: active
                  ? "#0e1a2b"
                  : done
                    ? "#8a6a2f"
                    : "rgba(14,26,43,0.35)",
              }}
            >
              {done ? "✓ " : ""}
              {s.label}
            </Text>
            {i < steps.length - 1 ? (
              <View
                style={{
                  height: 1,
                  width: 22,
                  backgroundColor: done ? "#b68b3c" : "rgba(14,26,43,0.18)",
                }}
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
