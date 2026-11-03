import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Sheet from "../Sheet";
// The disposal form itself lives in DisposalFields, which Hearing Track
// also renders inline. This panel used to keep a second, hand-copied
// version of the same four fields — which is how the two ended up
// offering different C.A. options. One component now, one behaviour.
import DisposalFields, {
  EMPTY_DISPOSAL,
  todayLocal,
  type DisposalRecord,
} from "./DisposalFields";
import DisposalSummary from "./DisposalSummary";
import { useAuth } from "../../lib/auth-context";
import {
  ApiError,
  partnerUpdateCase,
  type PartnerCase,
} from "../../lib/api";

// Disposal is the archive lever: status → "Disposed" stamps disposedAt
// and moves the matter to the archive; any other status clears it. Both
// transitions are office-admin only on the server, so "Close the matter"
// and "Reopen" only render for the admin. Closing a matter captures the
// full disposal record — recorded date, C.A. (certified-copy) status, a
// note and whether the client has the copy — in one sheet. Editing that
// record later isn't a transition (the matter stays Disposed), so anyone
// in the office can do it, the same as "Edit this matter".


function fmtStamp(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export default function DisposePanel({
  c,
  onChanged,
}: {
  c: PartnerCase;
  onChanged: (next: PartnerCase) => void;
}) {
  const { isPartnerAdmin } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [record, setRecord] = useState<DisposalRecord>(EMPTY_DISPOSAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disposed = Boolean(c.disposedAt);

  // Seed the sheet from what's on file (or today's date for a fresh
  // disposal) and open it. Used for both "close the matter" and, when
  // already disposed, "edit disposal details".
  function openSheet() {
    setRecord({
      disposalDate:
        (c.disposalDate || c.disposedAt || "").slice(0, 10) ||
        (disposed ? "" : todayLocal()),
      caStatus: c.caStatus || "",
      disposalRemarks: c.disposalRemarks || "",
      receivedByClient: Boolean(c.receivedByClient),
    });
    setError(null);
    setSheetOpen(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Re-sending status "Disposed" on an already-disposed matter is a
      // no-op transition server-side (disposedAt isn't bumped), so this
      // one call handles both the first disposal and later edits.
      const res = await partnerUpdateCase(c.id, {
        status: "Disposed",
        disposalDate: record.disposalDate || null,
        caStatus: record.caStatus.trim(),
        disposalRemarks: record.disposalRemarks.trim(),
        receivedByClient: record.receivedByClient,
      });
      setSheetOpen(false);
      onChanged(res.case);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't save. Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  function confirmReopen() {
    Alert.alert(
      "Reopen this matter?",
      `${c.caseNo} returns to the Case Vault with status “Filed”.`,
      [
        { text: "Keep archived", style: "cancel" },
        { text: "Reopen", onPress: () => void reopen() },
      ]
    );
  }

  async function reopen() {
    setBusy(true);
    try {
      const res = await partnerUpdateCase(c.id, { status: "Filed" });
      onChanged(res.case);
    } catch (err) {
      Alert.alert(
        "Couldn't reopen",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {disposed ? (
        <View
          className="mt-4 rounded-xl p-4"
          style={{
            backgroundColor: "#faf6ed",
            borderWidth: 1,
            borderColor: "#e3d9c0",
          }}
        >
          {/* Wraps so the buttons drop below the stamp on narrow phones
              instead of running off the card. */}
          <View
            className="flex-row flex-wrap items-center justify-between"
            style={{ rowGap: 10, columnGap: 8 }}
          >
            <View
              className="rounded-sm px-2 py-1"
              style={{
                borderWidth: 1.5,
                borderColor: "rgba(126,119,99,0.6)",
                transform: [{ rotate: "-2deg" }],
              }}
            >
              <Text
                className="text-[10px] uppercase"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.6,
                  color: "#7e7763",
                }}
              >
                Disposed · {fmtStamp(c.disposalDate ?? c.disposedAt)}
              </Text>
            </View>
            <View
              className="flex-row items-center"
              style={{ gap: 8, marginLeft: "auto" }}
            >
              <Pressable
                onPress={openSheet}
                disabled={busy}
                className="flex-row items-center gap-1.5 rounded-md px-3 py-2 active:opacity-80"
                style={{ backgroundColor: "#efe5d0" }}
                accessibilityRole="button"
                accessibilityLabel="Edit disposal details"
              >
                <Feather name="edit-2" size={13} color="#8a5821" />
                <Text
                  className="text-[12px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
                >
                  Edit
                </Text>
              </Pressable>
              {isPartnerAdmin ? (
                <Pressable
                  onPress={confirmReopen}
                  disabled={busy}
                  className="flex-row items-center gap-1.5 rounded-md px-3 py-2 active:opacity-80"
                  style={{ backgroundColor: "#efe5d0" }}
                  accessibilityRole="button"
                  accessibilityLabel="Reopen matter"
                >
                  {busy ? (
                    <ActivityIndicator size="small" color="#8a5821" />
                  ) : (
                    <Feather name="rotate-ccw" size={13} color="#8a5821" />
                  )}
                  <Text
                    className="text-[12px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
                  >
                    Reopen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>

          <DisposalSummary
            caStatus={c.caStatus || ""}
            receivedByClient={Boolean(c.receivedByClient)}
          />

          {c.disposalRemarks ? (
            <Text
              className="mt-3 text-[13px] leading-[20px] text-app-fg-soft"
              style={{ fontFamily: "Manrope" }}
            >
              “{c.disposalRemarks}”
            </Text>
          ) : null}
        </View>
      ) : isPartnerAdmin ? (
        <Pressable
          onPress={openSheet}
          className="mt-4 rounded-xl bg-app-paper p-4 flex-row items-center gap-3 active:opacity-85"
          style={{
            shadowColor: "#0a1124",
            shadowOpacity: 0.05,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 1 },
            elevation: 1,
          }}
          accessibilityRole="button"
          accessibilityLabel="Mark case as disposed"
        >
          <View
            className="h-9 w-9 items-center justify-center rounded-lg"
            style={{ backgroundColor: "#efe5d0" }}
          >
            <Feather name="archive" size={15} color="#8a5821" />
          </View>
          <View className="flex-1">
            <Text
              className="text-[14px] text-app-ink"
              style={{ fontFamily: "Manrope-SemiBold" }}
            >
              Close the matter
            </Text>
            <Text
              className="text-[11px] mt-0.5 text-app-fg-muted"
              style={{ fontFamily: "Manrope" }}
            >
              Mark as Disposed and record the details.
            </Text>
          </View>
          <Feather name="chevron-right" size={15} color="#8a5821" />
        </Pressable>
      ) : null}

      <Sheet
        visible={sheetOpen}
        onClose={busy ? () => {} : () => setSheetOpen(false)}
        eyebrow="The Archive"
        title={disposed ? `Disposal · ${c.caseNo}` : `Dispose ${c.caseNo}`}
        showClose={!busy}
        containerStyle={{ maxHeight: "90%" }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12 }}
        >
          {error ? (
            <View
              className="rounded-md px-3.5 py-2.5 mb-3"
              style={{ backgroundColor: "#f6dccd" }}
            >
              <Text
                className="text-[12.5px]"
                style={{ fontFamily: "Manrope", color: "#c14a37" }}
              >
                {error}
              </Text>
            </View>
          ) : null}

          <DisposalFields value={record} onChange={setRecord} />

          <Pressable
            onPress={save}
            disabled={busy}
            className="mt-5 rounded-xl items-center justify-center flex-row gap-2 active:opacity-90"
            style={{
              backgroundColor: "#0a1124",
              paddingVertical: 14,
              shadowColor: "#0a1124",
              shadowOpacity: 0.22,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
            accessibilityRole="button"
            accessibilityLabel={disposed ? "Save disposal details" : "Confirm disposal"}
          >
            {busy ? (
              <ActivityIndicator size="small" color="#f5ebd6" />
            ) : (
              <Feather name="archive" size={15} color="#f5ebd6" />
            )}
            <Text
              className="text-[13.5px]"
              style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
            >
              {busy
                ? "Saving…"
                : disposed
                  ? "Save details"
                  : "Dispose & archive"}
            </Text>
          </Pressable>
          <View style={{ height: 24 }} />
        </ScrollView>
      </Sheet>
    </>
  );
}
