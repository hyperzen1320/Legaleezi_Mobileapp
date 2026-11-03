import { useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { openSection } from "../../lib/navigation";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth-context";
import { ApiError, partnerCreateSupportTicket } from "../../lib/api";

// Support hub reachable from the bottom of the More menu: a quick tutorial
// plus an issue-report form. The form raises a real support ticket in the
// backend (Global-Admin support inbox), rather than only opening the mail
// app — so nothing is lost if the device has no mail client set up. The
// support address is still shown for anyone who prefers email.
const SUPPORT_EMAIL = "legalezi69@gmail.com";

const CATEGORIES = ["Bug", "Question", "Feature request", "Billing", "Other"];

const TUTORIAL: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
}[] = [
  {
    icon: "calendar",
    title: "Hearing Track",
    body: "Today / Tomorrow / Pending tabs. Tap Update to set the next date and stage; tap a CNR to copy it and open eCourts.",
  },
  {
    icon: "briefcase",
    title: "Case Vault",
    body: "Every matter, searchable by file no., case no., CNR or party. Open a case for the full dossier, documents and disposal.",
  },
  {
    icon: "message-square",
    title: "Senior Desk",
    body: "Office chat — private and group. Share files and images; tap an image to view it full-screen, then Share from the top bar.",
  },
  {
    icon: "layout",
    title: "Work Flow",
    body: "Boards for the office's own processes. Open a board to move cards and track each matter's progress.",
  },
];

export default function Support() {
  const router = useRouter();
  const { user } = useAuth();

  const [category, setCategory] = useState("Bug");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reporter = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();

  async function submit() {
    setError(null);
    if (message.trim().length < 5) {
      setError("Please describe the issue in a little more detail.");
      return;
    }
    setSubmitting(true);
    try {
      await partnerCreateSupportTicket({
        subject: subject.trim(),
        category,
        message: message.trim(),
        phone: phone.trim(),
      });
      setSent(true);
      setSubject("");
      setMessage("");
      setPhone("");
      setCategory("Bug");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't send. Check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

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
              Help &amp; Support
            </Text>
            <Text
              className="text-[18px] tracking-tight text-app-ink leading-none"
              style={{ fontFamily: "Crimson-SemiBold" }}
            >
              Support
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerClassName="px-5 pt-5 pb-10"
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Video tutorials — media library curated by the Legaleezi team */}
            <Pressable
              onPress={() => openSection("/(home)/tutorials")}
              className="rounded-2xl p-4 flex-row items-center gap-3 active:opacity-90"
              style={{
                backgroundColor: "#0a1124",
                marginBottom: 20,
                shadowColor: "#0a1124",
                shadowOpacity: 0.18,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 5 },
                elevation: 5,
              }}
              accessibilityRole="button"
              accessibilityLabel="Open video tutorials"
            >
              <View
                className="h-10 w-10 items-center justify-center rounded-xl"
                style={{ backgroundColor: "#c5853a" }}
              >
                <Feather name="play" size={18} color="#2a1c08" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[15px]"
                  style={{ fontFamily: "Crimson-SemiBold", color: "#f5ebd6" }}
                >
                  Video tutorials
                </Text>
                <Text
                  className="mt-0.5 text-[12px]"
                  style={{ fontFamily: "Manrope", color: "#ddb074" }}
                >
                  Watch walkthroughs &amp; guides
                </Text>
              </View>
              <Feather name="chevron-right" size={18} color="#ddb074" />
            </Pressable>

            {/* Quick tutorial */}
            <Text
              className="text-[11px] uppercase mb-2.5"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.8,
                color: "#8a5821",
              }}
            >
              Quick tutorial
            </Text>
            <View className="gap-3">
              {TUTORIAL.map((t) => (
                <View
                  key={t.title}
                  className="rounded-2xl bg-app-paper p-4 flex-row gap-3"
                  style={{
                    shadowColor: "#0a1124",
                    shadowOpacity: 0.04,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 1 },
                    elevation: 1,
                  }}
                >
                  <View
                    className="h-9 w-9 items-center justify-center rounded-lg"
                    style={{ backgroundColor: "#efe5d0" }}
                  >
                    <Feather name={t.icon} size={16} color="#8a5821" />
                  </View>
                  <View className="flex-1">
                    <Text
                      className="text-[14px] text-app-ink"
                      style={{ fontFamily: "Crimson-SemiBold" }}
                    >
                      {t.title}
                    </Text>
                    <Text
                      className="mt-1 text-[12.5px] text-app-fg-soft"
                      style={{ fontFamily: "Manrope", lineHeight: 18 }}
                    >
                      {t.body}
                    </Text>
                  </View>
                </View>
              ))}
            </View>

            {/* Report an issue */}
            <Text
              className="text-[11px] uppercase mt-7 mb-2.5"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.8,
                color: "#8a5821",
              }}
            >
              Report an issue
            </Text>

            {sent ? (
              <View
                className="rounded-2xl bg-app-paper p-5 items-center"
                style={{
                  shadowColor: "#0a1124",
                  shadowOpacity: 0.04,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 1,
                }}
              >
                <View
                  className="h-12 w-12 items-center justify-center rounded-full"
                  style={{ backgroundColor: "#d2e6e7" }}
                >
                  <Feather name="check" size={22} color="#3f9a8c" />
                </View>
                <Text
                  className="mt-3 text-[16px] text-app-ink"
                  style={{ fontFamily: "Crimson-SemiBold" }}
                >
                  Thanks — we&rsquo;ve got it.
                </Text>
                <Text
                  className="mt-1 text-[12.5px] text-app-fg-muted text-center"
                  style={{ fontFamily: "Manrope", lineHeight: 18 }}
                >
                  Your issue is with the Legaleezi team. We&rsquo;ll be in touch
                  if we need more detail.
                </Text>
                <Pressable
                  onPress={() => setSent(false)}
                  className="mt-4 rounded-xl px-4 py-2.5 active:opacity-80"
                  style={{ backgroundColor: "#efe5d0" }}
                >
                  <Text
                    className="text-[12.5px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
                  >
                    Report another
                  </Text>
                </Pressable>
              </View>
            ) : (
              <View
                className="rounded-2xl bg-app-paper p-5"
                style={{
                  gap: 16,
                  shadowColor: "#0a1124",
                  shadowOpacity: 0.04,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 1,
                }}
              >
                {/* Category */}
                <View>
                  <Text
                    className="text-[11px] uppercase mb-2"
                    style={{
                      fontFamily: "DMMono-Medium",
                      letterSpacing: 1.2,
                      color: "#8a5821",
                    }}
                  >
                    Category
                  </Text>
                  <View className="flex-row flex-wrap" style={{ gap: 8 }}>
                    {CATEGORIES.map((c) => {
                      const on = category === c;
                      return (
                        <Pressable
                          key={c}
                          onPress={() => setCategory(c)}
                          className="rounded-full px-3 py-1.5 active:opacity-70"
                          style={{
                            backgroundColor: on ? "#0a1124" : "#faf6ee",
                            borderWidth: 1,
                            borderColor: on ? "#0a1124" : "#e3d9c0",
                          }}
                        >
                          <Text
                            className="text-[12px]"
                            style={{
                              fontFamily: on ? "Manrope-SemiBold" : "Manrope",
                              color: on ? "#f5ebd6" : "#0a1124",
                            }}
                          >
                            {c}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                <SupportField
                  label="Subject (optional)"
                  value={subject}
                  onChangeText={setSubject}
                  placeholder="A short summary"
                />
                <SupportField
                  label="What went wrong?"
                  value={message}
                  onChangeText={setMessage}
                  placeholder="Steps, the screen, anything that helps."
                  multiline
                />
                <SupportField
                  label="Phone (optional)"
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="If you'd like a call back"
                  keyboardType="phone-pad"
                />

                {reporter ? (
                  <Text
                    className="text-[11px] text-app-fg-muted"
                    style={{ fontFamily: "Manrope" }}
                  >
                    Reporting as{" "}
                    <Text style={{ fontFamily: "Manrope-SemiBold" }}>
                      {reporter}
                    </Text>
                    {user?.email ? ` · ${user.email}` : ""}
                  </Text>
                ) : null}

                {error ? (
                  <Text
                    className="text-[12px]"
                    style={{ fontFamily: "Manrope", color: "#c14a37" }}
                  >
                    {error}
                  </Text>
                ) : null}

                <Pressable
                  onPress={submit}
                  disabled={submitting}
                  className="rounded-xl items-center justify-center flex-row gap-2 active:opacity-90"
                  style={{
                    backgroundColor: "#c5853a",
                    paddingVertical: 14,
                    opacity: submitting ? 0.7 : 1,
                    shadowColor: "#c5853a",
                    shadowOpacity: 0.3,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 3,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Send issue report"
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#2a1c08" />
                  ) : (
                    <Feather name="send" size={15} color="#2a1c08" />
                  )}
                  <Text
                    className="text-[13.5px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#2a1c08" }}
                  >
                    {submitting ? "Sending…" : "Send to support"}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() =>
                    Linking.openURL(
                      `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
                        "Legaleezi support"
                      )}`
                    ).catch(() => undefined)
                  }
                  hitSlop={6}
                >
                  <Text
                    className="text-[11px] text-app-fg-muted text-center"
                    style={{ fontFamily: "Manrope" }}
                  >
                    or email us at{" "}
                    <Text
                      style={{
                        fontFamily: "Manrope-SemiBold",
                        color: "#8a5821",
                      }}
                    >
                      {SUPPORT_EMAIL}
                    </Text>
                  </Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function SupportField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: "default" | "phone-pad";
}) {
  return (
    <View>
      <Text
        className="text-[11px] uppercase mb-1.5"
        style={{
          fontFamily: "DMMono-Medium",
          letterSpacing: 1.2,
          color: "#8a5821",
        }}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#a89c80"
        multiline={multiline}
        keyboardType={keyboardType}
        className="rounded-xl text-[14px] text-app-ink"
        style={{
          fontFamily: "Manrope",
          paddingHorizontal: 14,
          paddingVertical: multiline ? 12 : 11,
          minHeight: multiline ? 104 : undefined,
          textAlignVertical: multiline ? "top" : "center",
          backgroundColor: "#faf6ee",
          borderWidth: 1,
          borderColor: "#e3d9c0",
        }}
      />
    </View>
  );
}
