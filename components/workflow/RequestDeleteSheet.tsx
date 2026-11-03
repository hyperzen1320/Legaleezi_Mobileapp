import { useState } from "react";
import {
  Modal,
  Pressable,
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  partnerCreateDeleteRequest,
  ApiError,
  type DeleteRequestRequiredError,
} from "../../lib/api";

/**
 * "Why delete?" sheet shown when the server replies 403 with the
 * `delete_request_required` code on a delete attempt. Mirrors the web
 * behaviour: at least 4 chars of reason, sent to the admin's review
 * queue.
 */
export default function RequestDeleteSheet({
  target,
  onClose,
  onSubmitted,
}: {
  target: DeleteRequestRequiredError | null;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason("");
    setError(null);
  }

  async function submit() {
    if (!target) return;
    if (reason.trim().length < 4) {
      setError("Tell admin a few words about why.");
      return;
    }
    setSubmitting(true);
    try {
      await partnerCreateDeleteRequest({
        targetType: target.targetType,
        targetId: target.targetId,
        reason: reason.trim(),
      });
      reset();
      onSubmitted();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Couldn't send the request — try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  const targetLabel =
    target?.targetType === "list"
      ? "list"
      : target?.targetType === "task"
        ? "card"
        : (target?.targetType ?? "item");

  return (
    <Modal
      visible={Boolean(target)}
      transparent
      animationType="fade"
      onRequestClose={() => {
        reset();
        onClose();
      }}
      statusBarTranslucent
    >
      <Pressable
        onPress={() => {
          reset();
          onClose();
        }}
        className="flex-1"
        style={{ backgroundColor: "rgba(10,17,36,0.55)" }}
      >
        {/* "height" on Android too. With edge-to-edge on, the system no
            longer resizes a Modal's window for the keyboard (and the app's
            "pan" mode only moves full screens), so leaving Android
            undefined left the reason box under the keyboard. Same
            approach as the shared Sheet; statusBarTranslucent keeps this
            view's frame in the same coordinates as the keyboard's. */}
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, justifyContent: "flex-end" }}
        >
          <Pressable
            onPress={() => {
              /* swallow */
            }}
            className="rounded-t-3xl"
            style={{
              backgroundColor: "#ffffff",
              paddingHorizontal: 20,
              paddingTop: 14,
              paddingBottom: 28,
              shadowColor: "#0a1124",
              shadowOpacity: 0.2,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: -6 },
              elevation: 12,
            }}
          >
            <View
              className="self-center mb-3 h-1.5 w-12 rounded-full"
              style={{ backgroundColor: "#e3d9c0" }}
            />
            <View className="flex-row items-start gap-3 mb-3">
              <View
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: "#f6dccd" }}
              >
                <Feather name="alert-triangle" size={15} color="#c14a37" />
              </View>
              <View className="flex-1">
                <Text
                  className="text-[10px] uppercase text-app-copper-deep"
                  style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.6 }}
                >
                  Admin review needed
                </Text>
                <Text
                  className="mt-0.5 text-[17px] tracking-tight text-app-ink"
                  style={{ fontFamily: "Crimson-SemiBold" }}
                >
                  Request to delete {targetLabel}
                </Text>
                <Text
                  className="mt-1 text-[12px] text-app-fg-muted"
                  style={{ fontFamily: "Manrope" }}
                  numberOfLines={2}
                >
                  <Text style={{ color: "#0a1124", fontFamily: "Manrope-SemiBold" }}>
                    {target?.targetName}
                  </Text>
                  {target?.error ? ` · ${target.error}` : ""}
                </Text>
              </View>
            </View>

            <Text
              className="text-[10px] uppercase text-app-fg-muted mt-1"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.6 }}
            >
              Why?
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder="Two-line reason — admin reads this before approving."
              placeholderTextColor="#a89c80"
              multiline
              numberOfLines={3}
              autoCapitalize="sentences"
              style={{
                marginTop: 6,
                borderWidth: 1,
                borderColor: error ? "#c14a37" : "#e3d9c0",
                backgroundColor: "#ffffff",
                borderRadius: 8,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontFamily: "Manrope",
                fontSize: 13,
                color: "#0a1124",
                minHeight: 80,
                textAlignVertical: "top",
              }}
            />
            {error ? (
              <Text
                className="mt-2 text-[12px]"
                style={{ fontFamily: "Manrope", color: "#c14a37" }}
              >
                {error}
              </Text>
            ) : null}

            <View className="mt-4 flex-row gap-2">
              <Pressable
                onPress={() => {
                  reset();
                  onClose();
                }}
                disabled={submitting}
                className="flex-1 rounded-md py-3 items-center active:opacity-50"
                style={{
                  borderWidth: 1,
                  borderColor: "#e3d9c0",
                  backgroundColor: "#ffffff",
                }}
              >
                <Text
                  className="text-[13px]"
                  style={{ fontFamily: "Manrope-Medium", color: "#4d4538" }}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={submit}
                disabled={submitting}
                className="flex-[1.4] rounded-md py-3 items-center justify-center flex-row gap-2"
                style={{
                  backgroundColor: "#c5853a",
                  opacity: submitting ? 0.6 : 1,
                  shadowColor: "#c5853a",
                  shadowOpacity: 0.3,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 5,
                }}
              >
                {submitting ? (
                  <ActivityIndicator size="small" color="#2a1c08" />
                ) : (
                  <Text
                    className="text-[13px]"
                    style={{
                      fontFamily: "Manrope-SemiBold",
                      color: "#2a1c08",
                    }}
                  >
                    Send request
                  </Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}
