import { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { backToList } from "../../../lib/navigation";
import { Feather } from "@expo/vector-icons";
import { adminCreatePartner, ApiError } from "../../../lib/api";

type Plan = "trial" | "solo" | "office" | "chambers";

const PLAN_DETAILS: Record<
  Plan,
  { label: string; price: string; desc: string; isTrial: boolean }
> = {
  trial: {
    label: "Trial",
    price: "Free · time-limited",
    desc: "Full access for a fixed window. Login blocked when trial ends.",
    isTrial: true,
  },
  solo: {
    label: "Solo",
    price: "₹1,499 / mo",
    desc: "1 advocate, 100 active matters.",
    isTrial: false,
  },
  office: {
    label: "Office",
    price: "₹4,999 / mo",
    desc: "Up to 10 users, 1,000 matters.",
    isTrial: false,
  },
  chambers: {
    label: "Chambers",
    price: "Bespoke",
    desc: "Unlimited users + matters.",
    isTrial: false,
  },
};

export default function NewPartner() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [plan, setPlan] = useState<Plan>("trial");
  const [trialDays, setTrialDays] = useState("14");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  async function onSubmit() {
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords don't match.");
      return;
    }

    setSubmitting(true);
    try {
      await adminCreatePartner({
        name,
        primaryEmail,
        primaryContactName,
        phone,
        city,
        state: stateField,
        plan,
        trialDays: plan === "trial" ? Number(trialDays) || 14 : 0,
        password,
      });
      backToList("/(admin)/partners");
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Couldn't create.";
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-admin-bg">
      <StatusBar style="dark" backgroundColor="#fafaf7" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar />
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          className="flex-1"
        >
          <ScrollView
            contentContainerClassName="px-5 pb-12"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View className="pt-6">
              <Text
                className="font-plex-mono-medium text-[10px] uppercase text-admin-accent"
                style={{ letterSpacing: 1.8 }}
              >
                New chambers
              </Text>
              <Text className="mt-2 font-plex-bold text-[26px] text-admin-fg leading-tight">
                Add a Partner
              </Text>
              <Text className="mt-2 font-plex text-[13px] leading-[20px] text-admin-fg-muted">
                Create a partner chambers and the partner-admin login. The
                email is the user ID — must be unique across Legaleezi.
              </Text>
            </View>

            {/* Organization */}
            <Section title="Organization" subtitle="Who's the chambers?">
              <Field
                label="Chambers Name"
                required
                value={name}
                onChangeText={setName}
                placeholder="K S Nagendhran & Associates"
                autoCapitalize="words"
              />
            </Section>

            {/* Primary Contact */}
            <Section
              title="Primary Contact"
              subtitle="The partner-admin who'll sign in. Email is the user ID."
            >
              <Field
                label="Contact Name"
                required
                value={primaryContactName}
                onChangeText={setPrimaryContactName}
                placeholder="K S Nagendhran"
                autoCapitalize="words"
              />
              <Field
                label="Phone"
                required
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                keyboardType="phone-pad"
              />
              <Field
                label="Login Email"
                required
                value={primaryEmail}
                onChangeText={setPrimaryEmail}
                placeholder="ks@nagendhran.in"
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <Field
                    label="City"
                    value={city}
                    onChangeText={setCity}
                    placeholder="Bengaluru"
                    autoCapitalize="words"
                  />
                </View>
                <View className="flex-1">
                  <Field
                    label="State"
                    value={stateField}
                    onChangeText={setStateField}
                    placeholder="Karnataka"
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </Section>

            {/* Plan */}
            <Section title="Plan" subtitle="Trial blocks access when the period ends.">
              <View className="gap-2">
                {(Object.keys(PLAN_DETAILS) as Plan[]).map((p) => (
                  <PlanRow
                    key={p}
                    plan={p}
                    selected={plan === p}
                    onSelect={() => setPlan(p)}
                  />
                ))}
              </View>

              {plan === "trial" ? (
                <View className="mt-4 border border-admin-saffron/30 bg-admin-saffron-soft rounded-md px-4 py-3.5">
                  <Text
                    className="font-plex-mono-medium text-[10px] uppercase text-admin-saffron"
                    style={{ letterSpacing: 1.5 }}
                  >
                    Trial period
                  </Text>
                  <View className="mt-2 flex-row items-center gap-3">
                    <TextInput
                      value={trialDays}
                      onChangeText={setTrialDays}
                      keyboardType="number-pad"
                      className="bg-white border border-admin-saffron/30 rounded-md px-3 py-1.5 w-20 text-[14px] tabular-nums text-admin-fg font-plex-mono"
                      maxLength={3}
                    />
                    <Text className="font-plex text-[12px] text-admin-fg-muted flex-1">
                      days · login blocks after this
                    </Text>
                  </View>
                </View>
              ) : null}
            </Section>

            {/* Password */}
            <Section
              title="Initial Password"
              subtitle="Partner-admin can change after sign in."
            >
              <PasswordField
                label="Password"
                value={password}
                onChangeText={setPassword}
                show={showPw}
                onToggleShow={() => setShowPw((s) => !s)}
                placeholder="At least 6 characters"
              />
              <PasswordField
                label="Confirm"
                value={confirmPw}
                onChangeText={setConfirmPw}
                show={showPw}
                onToggleShow={() => setShowPw((s) => !s)}
                placeholder="Match the above"
              />
            </Section>

            {error ? (
              <View className="mt-5 rounded-md border border-admin-danger/30 bg-admin-danger-soft px-4 py-3">
                <Text
                  className="font-plex-mono-medium text-[10px] uppercase text-admin-danger"
                  style={{ letterSpacing: 1.5 }}
                >
                  Couldn't add chambers
                </Text>
                <Text className="mt-1.5 font-plex text-[13px] text-admin-fg">
                  {error}
                </Text>
              </View>
            ) : null}

            <View className="mt-6 flex-row gap-3">
              <Pressable
                onPress={() => router.back()}
                className="flex-1 border border-admin-border bg-admin-surface active:bg-admin-bg rounded-md py-3.5 items-center"
              >
                <Text className="font-plex-medium text-[13px] text-admin-fg-muted">
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={onSubmit}
                disabled={submitting}
                className="flex-1 bg-admin-accent active:bg-admin-accent-hover rounded-md py-3.5 items-center flex-row justify-center gap-2"
                style={{ opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <>
                    <Text className="font-plex-bold text-[13px] text-white">
                      Create
                    </Text>
                    <Feather name="arrow-right" size={14} color="white" />
                  </>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function TopBar() {
  const router = useRouter();
  return (
    <View className="bg-admin-surface border-b border-admin-border">
      <View className="h-[2px] bg-admin-accent" />
      <View className="px-5 py-3.5 flex-row items-center justify-between">
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          className="flex-row items-center gap-2 active:opacity-50"
        >
          <Feather name="arrow-left" size={16} color="#0e1a1f" />
          <Text className="font-plex-medium text-[13px] text-admin-fg">
            Partners
          </Text>
        </Pressable>
        <Text
          className="font-plex-mono-medium text-[10px] uppercase text-admin-fg-soft"
          style={{ letterSpacing: 1.5 }}
        >
          New
        </Text>
      </View>
    </View>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-6 bg-admin-surface border border-admin-border rounded-lg p-5">
      <View className="border-b border-admin-border-soft pb-3 mb-4">
        <Text className="font-plex-bold text-[14px] text-admin-fg">{title}</Text>
        {subtitle ? (
          <Text className="mt-0.5 font-plex text-[11px] text-admin-fg-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View className="gap-4">{children}</View>
    </View>
  );
}

function Field({
  label,
  required,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "email-address" | "phone-pad" | "number-pad";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View>
      <Text
        className="font-plex-mono-medium text-[10px] uppercase text-admin-fg-muted"
        style={{ letterSpacing: 1.3 }}
      >
        {label}
        {required ? <Text className="text-admin-accent">  *</Text> : null}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8a929e"
        keyboardType={keyboardType ?? "default"}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        className="mt-1.5 bg-admin-surface border border-admin-border rounded-md px-3 py-2.5 font-plex text-[14px] text-admin-fg"
      />
    </View>
  );
}

function PasswordField({
  label,
  value,
  onChangeText,
  show,
  onToggleShow,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  show: boolean;
  onToggleShow: () => void;
  placeholder?: string;
}) {
  return (
    <View>
      <View className="flex-row items-baseline justify-between">
        <Text
          className="font-plex-mono-medium text-[10px] uppercase text-admin-fg-muted"
          style={{ letterSpacing: 1.3 }}
        >
          {label}
          <Text className="text-admin-accent">  *</Text>
        </Text>
        <Pressable onPress={onToggleShow} hitSlop={6} className="active:opacity-50">
          <Text
            className="font-plex-mono-medium text-[9px] uppercase text-admin-fg-soft"
            style={{ letterSpacing: 1.5 }}
          >
            {show ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8a929e"
        secureTextEntry={!show}
        autoCapitalize="none"
        autoCorrect={false}
        className="mt-1.5 bg-admin-surface border border-admin-border rounded-md px-3 py-2.5 font-plex text-[14px] text-admin-fg"
      />
    </View>
  );
}

function PlanRow({
  plan,
  selected,
  onSelect,
}: {
  plan: Plan;
  selected: boolean;
  onSelect: () => void;
}) {
  const d = PLAN_DETAILS[plan];
  const accent = d.isTrial ? "saffron" : "emerald";
  const sel = accent === "saffron"
    ? "border-admin-saffron bg-admin-saffron-soft"
    : "border-admin-accent bg-admin-accent-soft";
  const checkBg = accent === "saffron"
    ? "border-admin-saffron bg-admin-saffron"
    : "border-admin-accent bg-admin-accent";

  return (
    <Pressable
      onPress={onSelect}
      className={`border-2 rounded-md p-3.5 flex-row items-center gap-3 ${
        selected ? sel : "border-admin-border bg-admin-surface"
      }`}
    >
      <View
        className={`h-5 w-5 rounded-full border-2 items-center justify-center ${
          selected ? checkBg : "border-admin-border bg-white"
        }`}
      >
        {selected ? (
          <Feather name="check" size={11} color="white" strokeWidth={3} />
        ) : null}
      </View>
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="font-plex-bold text-[14px] text-admin-fg">
            {d.label}
          </Text>
          {d.isTrial ? (
            <Text
              className="font-plex-mono-medium text-[8px] uppercase text-admin-saffron bg-admin-saffron-soft px-1.5 py-0.5 rounded-sm"
              style={{ letterSpacing: 1 }}
            >
              Time-limited
            </Text>
          ) : null}
        </View>
        <Text
          className="mt-0.5 font-plex-mono text-[11px] text-admin-fg-muted"
          style={{ letterSpacing: 0.3 }}
        >
          {d.price}
        </Text>
        <Text className="mt-1 font-plex text-[11px] leading-[16px] text-admin-fg-muted">
          {d.desc}
        </Text>
      </View>
    </Pressable>
  );
}
