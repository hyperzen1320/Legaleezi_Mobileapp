import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import {
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { backToList } from "../../../lib/navigation";
import { Feather } from "@expo/vector-icons";
import {
  partnerListUsers,
  partnerUpdateUser,
  partnerDeleteUser,
  ApiError,
  type PartnerStaffUser,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { Field, SheetField } from "../../../components/CaseFields";
import {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  rolePill,
  roleKeyFromLabel,
  roleLabel as labelForRole,
} from "../../../components/RoleHelpers";

export default function UserDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { isPartnerAdmin: isAdmin } = useAuth();
  const [user, setUser] = useState<PartnerStaffUser | null>(null);
  const [meId, setMeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const list = await partnerListUsers();
      const found = list.users.find((u) => u.id === String(id));
      if (!found) {
        setError("User not found.");
        setUser(null);
      } else {
        setUser({ ...found, isYou: found.id === list.currentUserId });
        setError(null);
      }
      setMeId(list.currentUserId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, [id]);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Returning here after an edit lands on this screen without remounting
  // it, so re-read the record rather than showing what it used to say.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center gap-3">
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="active:opacity-50"
          >
            <Feather name="arrow-left" size={18} color="#0a1124" />
          </Pressable>
          <Text
            className="text-[14px] font-semibold text-app-ink"
            style={{ fontFamily: "Manrope-SemiBold" }}
          >
            Users / Advocates
          </Text>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : !user ? (
          <View className="flex-1 items-center justify-center px-8">
            <Feather name="alert-circle" size={28} color="#c14a37" />
            <Text
              className="mt-3 text-[14px] text-app-fg-muted text-center"
              style={{ fontFamily: "Manrope" }}
            >
              {error ?? "User not found."}
            </Text>
          </View>
        ) : (
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            className="flex-1"
          >
            <ScrollView
              contentContainerClassName="px-5 pt-5 pb-12 sm:max-w-[560px] sm:self-center sm:w-full"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
            >
              <Hero user={user} />

              {isAdmin && !user.isYou ? (
                <EditPanel
                  user={user}
                  meId={meId}
                  onUpdated={(u) => setUser(u)}
                  onRemoved={() => backToList("/(home)/users")}
                />
              ) : !isAdmin ? (
                <View
                  className="mt-5 rounded-xl px-4 py-3.5 flex-row items-start gap-3"
                  style={{
                    backgroundColor: "rgba(86,160,168,0.10)",
                    borderWidth: 1,
                    borderColor: "rgba(86,160,168,0.30)",
                  }}
                >
                  <Feather name="info" size={16} color="#56a0a8" />
                  <Text
                    className="flex-1 text-[12px] leading-[1.5]"
                    style={{ fontFamily: "Manrope", color: "#0a1124" }}
                  >
                    Only the office admin can edit team members.
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </View>
  );
}

/* ─── Hero ─── */

function Hero({ user }: { user: PartnerStaffUser }) {
  const initials =
    `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase();
  const isPartnerAdmin = user.userType === "partner_admin";
  const pill = rolePill(user.role);

  return (
    <View
      className="rounded-2xl bg-app-paper p-5"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.06,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 },
        elevation: 3,
      }}
    >
      <View className="flex-row items-center gap-4">
        <View
          className="h-16 w-16 rounded-full items-center justify-center"
          style={{
            backgroundColor: isPartnerAdmin ? "#c5853a" : "#0a1124",
          }}
        >
          {initials ? (
            <Text
              className="text-[20px]"
              style={{
                fontFamily: "Crimson-SemiBold",
                color: isPartnerAdmin ? "#2a1c08" : "#f5ebd6",
              }}
            >
              {initials}
            </Text>
          ) : (
            <Feather
              name="user"
              size={24}
              color={isPartnerAdmin ? "#2a1c08" : "#f5ebd6"}
            />
          )}
        </View>
        <View className="flex-1 min-w-0">
          <View className="flex-row items-baseline gap-2 flex-wrap">
            <Text
              className="text-[22px] font-semibold tracking-tight leading-[1.15] text-app-ink"
              style={{ fontFamily: "Crimson-SemiBold" }}
              numberOfLines={2}
            >
              {user.name || "—"}
            </Text>
            {user.isYou ? (
              <View
                className="rounded px-1.5 py-0.5"
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
                  You
                </Text>
              </View>
            ) : null}
          </View>

          <View className="mt-1.5 flex-row items-center gap-2 flex-wrap">
            <View
              className="rounded-md px-2 py-0.5"
              style={{ backgroundColor: pill.bg }}
            >
              <Text
                className="text-[9px] font-semibold uppercase"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.2,
                  color: pill.fg,
                }}
              >
                {pill.label}
              </Text>
            </View>
            {!user.active ? (
              <View
                className="rounded-md px-2 py-0.5"
                style={{ backgroundColor: "#f6dccd" }}
              >
                <Text
                  className="text-[9px] font-semibold uppercase"
                  style={{
                    fontFamily: "DMMono-Medium",
                    letterSpacing: 1.2,
                    color: "#c14a37",
                  }}
                >
                  Inactive
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      <View className="mt-4 gap-1.5">
        <Text
          className="text-[12px]"
          style={{
            fontFamily: "DMMono",
            color: "#4d4538",
            letterSpacing: 0.3,
          }}
        >
          {user.email}
        </Text>
        {user.phone ? (
          <Text
            className="text-[12px]"
            style={{
              fontFamily: "DMMono",
              color: "#4d4538",
              letterSpacing: 0.3,
            }}
          >
            {user.phone}
          </Text>
        ) : null}
        {user.designation ? (
          <Text
            className="text-[12px]"
            style={{ fontFamily: "Manrope", color: "#7a7060" }}
          >
            {user.designation}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/* ─── Edit panel (admin only, target ≠ self) ─── */

function EditPanel({
  user,
  meId,
  onUpdated,
  onRemoved,
}: {
  user: PartnerStaffUser;
  meId: string;
  onUpdated: (u: PartnerStaffUser) => void;
  onRemoved: () => void;
}) {
  const targetIsAdmin = user.userType === "partner_admin";

  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [roleLabel, setRoleLabel] = useState(labelForRole(user.role));
  const [designation, setDesignation] = useState(user.designation);
  const [phone, setPhone] = useState(user.phone);

  const [resettingPwd, setResettingPwd] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<"none" | "toggle" | "delete">("none");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    firstName !== user.firstName ||
    lastName !== user.lastName ||
    (!targetIsAdmin && roleLabel !== labelForRole(user.role)) ||
    designation !== user.designation ||
    phone !== user.phone ||
    (resettingPwd && newPassword.length > 0);

  async function save() {
    setError(null);
    if (!firstName.trim()) {
      setError("First name is required.");
      return;
    }
    if (resettingPwd && newPassword.length > 0 && newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName,
        lastName,
        designation,
        phone,
      };
      if (!targetIsAdmin) {
        payload.role = roleKeyFromLabel(roleLabel);
      }
      if (resettingPwd && newPassword.length > 0) {
        payload.password = newPassword;
      }
      const res = await partnerUpdateUser(user.id, payload);
      onUpdated({ ...res.user, isYou: res.user.id === meId });
      setNewPassword("");
      setResettingPwd(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  function confirmToggle() {
    const next = !user.active;
    Alert.alert(
      next ? "Activate this user?" : "Deactivate this user?",
      next
        ? "They'll be able to log in again immediately."
        : "They will no longer be able to log in. Their data and history are preserved.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: next ? "Activate" : "Deactivate",
          style: next ? "default" : "destructive",
          onPress: async () => {
            setBusy("toggle");
            try {
              const res = await partnerUpdateUser(user.id, { active: next });
              onUpdated({ ...res.user, isYou: res.user.id === meId });
            } catch (err) {
              Alert.alert(
                "Couldn't update",
                err instanceof ApiError ? err.message : "Try again."
              );
            } finally {
              setBusy("none");
            }
          },
        },
      ]
    );
  }

  function confirmDelete() {
    Alert.alert(
      `Remove ${user.firstName || "this user"}?`,
      "This will revoke their access and remove them from the directory.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            try {
              await partnerDeleteUser(user.id);
              onRemoved();
            } catch (err) {
              Alert.alert(
                "Couldn't remove",
                err instanceof ApiError ? err.message : "Try again."
              );
              setBusy("none");
            }
          },
        },
      ]
    );
  }

  return (
    <View
      className="mt-5 rounded-2xl bg-app-paper p-5"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: "#c5853a",
      }}
    >
      <Text
        className="text-[10px] uppercase text-app-copper-deep mb-4"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        Edit member
      </Text>

      <View className="gap-4">
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field
              label="First name"
              required
              value={firstName}
              onChangeText={setFirstName}
              autoCapitalize="words"
            />
          </View>
          <View className="flex-1">
            <Field
              label="Last name"
              value={lastName}
              onChangeText={setLastName}
              autoCapitalize="words"
            />
          </View>
        </View>

        {!targetIsAdmin ? (
          <View>
            <SheetField
              label="Role"
              value={roleLabel}
              options={STAFF_ROLE_LABELS}
              onChange={setRoleLabel}
            />
            <Text
              className="mt-1.5 text-[11px]"
              style={{ fontFamily: "Manrope", color: "#7a7060" }}
            >
              {STAFF_ROLES.find((r) => r.label === roleLabel)?.description}
            </Text>
          </View>
        ) : null}

        <Field
          label="Designation"
          value={designation}
          onChangeText={setDesignation}
          placeholder="Junior Advocate / Office Manager"
          autoCapitalize="words"
        />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          placeholder="+91 98xxx 43210"
          keyboardType="phone-pad"
        />

        {/* Reset password */}
        {!resettingPwd ? (
          <Pressable
            onPress={() => setResettingPwd(true)}
            className="self-start active:opacity-50"
          >
            <Text
              className="text-[11px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.5,
                color: "#8a5821",
              }}
            >
              Reset password
            </Text>
          </Pressable>
        ) : (
          <View>
            <Text
              className="text-[10px] font-semibold uppercase text-app-fg-muted"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.6 }}
            >
              New password
            </Text>
            <View className="relative mt-1.5">
              <TextInput
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPwd}
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="new-password"
                className="rounded-md border bg-app-paper px-3.5 py-3 text-[15px] text-app-ink"
                style={{
                  fontFamily: "DMMono-Medium",
                  borderColor: "#e3d9c0",
                  letterSpacing: 0.5,
                  paddingRight: 64,
                }}
              />
              <Pressable
                onPress={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-1.5 active:opacity-50"
                hitSlop={6}
              >
                <Text
                  className="text-[10px] font-semibold uppercase"
                  style={{
                    fontFamily: "DMMono-Medium",
                    letterSpacing: 1.4,
                    color: "#8a5821",
                  }}
                >
                  {showPwd ? "Hide" : "Show"}
                </Text>
              </Pressable>
            </View>
            <Text
              className="mt-1.5 text-[11px]"
              style={{ fontFamily: "Manrope", color: "#7a7060" }}
            >
              At least 8 characters. Share with the team member.
            </Text>
          </View>
        )}
      </View>

      {error ? (
        <Text
          className="mt-3 text-[12px]"
          style={{ fontFamily: "Manrope", color: "#c14a37" }}
        >
          {error}
        </Text>
      ) : null}

      {/* Save / Cancel */}
      <View className="mt-5 flex-row gap-3">
        <Pressable
          onPress={save}
          disabled={!dirty || saving}
          className="flex-1 rounded-md py-3 items-center justify-center flex-row gap-2"
          style={{
            backgroundColor: dirty ? "#c5853a" : "#efe5d0",
            opacity: saving ? 0.6 : 1,
            shadowColor: dirty ? "#c5853a" : "transparent",
            shadowOpacity: dirty ? 0.3 : 0,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: dirty ? 4 : 0,
          }}
        >
          {saving ? (
            <ActivityIndicator color="#2a1c08" size="small" />
          ) : (
            <Text
              className="text-[13px] font-semibold"
              style={{
                fontFamily: "Manrope-SemiBold",
                color: dirty ? "#2a1c08" : "#a89c80",
              }}
            >
              Save Changes
            </Text>
          )}
        </Pressable>
      </View>

      {/* Danger zone */}
      {!targetIsAdmin ? (
        <View
          className="mt-6 pt-5 border-t flex-row gap-3"
          style={{ borderColor: "#efe5d0" }}
        >
          <Pressable
            onPress={confirmToggle}
            disabled={busy !== "none"}
            className="flex-1 rounded-md py-2.5 items-center active:opacity-50"
            style={{
              backgroundColor: "#ffffff",
              borderWidth: 1,
              borderColor: "#e3d9c0",
              opacity: busy !== "none" ? 0.5 : 1,
            }}
          >
            <Text
              className="text-[12px] font-medium"
              style={{
                fontFamily: "Manrope-Medium",
                color: user.active ? "#4d4538" : "#56a0a8",
              }}
            >
              {busy === "toggle"
                ? "…"
                : user.active
                  ? "Deactivate"
                  : "Activate"}
            </Text>
          </Pressable>
          <Pressable
            onPress={confirmDelete}
            disabled={busy !== "none"}
            className="flex-1 rounded-md py-2.5 items-center active:opacity-50 flex-row justify-center gap-1.5"
            style={{
              backgroundColor: "transparent",
              borderWidth: 1,
              borderColor: "#c14a37",
              opacity: busy !== "none" ? 0.5 : 1,
            }}
          >
            {busy === "delete" ? (
              <ActivityIndicator size="small" color="#c14a37" />
            ) : (
              <Feather name="trash-2" size={13} color="#c14a37" />
            )}
            <Text
              className="text-[12px] font-medium"
              style={{ fontFamily: "Manrope-Medium", color: "#c14a37" }}
            >
              Remove
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
