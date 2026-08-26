import { useCallback, useEffect, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Linking,
  RefreshControl,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather, FontAwesome } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  partnerGetCase,
  partnerUpdateCase,
  partnerDeleteCase,
  ApiError,
  type PartnerCase,
} from "../../lib/api";
import { useDeleteRequestFallback } from "../useDeleteRequestFallback";
import { DateField, formatDateForDisplay } from "../CaseFields";
import StatusCombobox from "./StatusCombobox";
import DocumentsPanel from "./DocumentsPanel";
import DisposePanel from "./DisposePanel";
import CnrChip from "../CnrChip";

// The whole case dossier as an embeddable view — the [id] route wraps it
// full-screen on phones; the Case Vault renders it as the right pane of
// the tablet two-pane. The host owns chrome (top bar / status bar) and
// what "deleted" means for navigation.

export default function CaseDetailView({
  caseId,
  onDeleted,
}: {
  caseId: string;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [data, setData] = useState<{
    case: PartnerCase;
    officeName: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!caseId) return;
    try {
      const res = await partnerGetCase(caseId);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load case");
    }
  }, [caseId]);

  // Fresh dossier whenever the host points this view at another matter
  // (tablet pane selection changes without a remount).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    load().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Popping back from the editor lands on this screen without
  // remounting it, so without this the dossier would still show the
  // values you had just changed. Silent — the pull-to-refresh spinner is
  // for a refresh you asked for.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  return (
    <View className="flex-1 bg-app-canvas">
      {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : error || !data ? (
          <ErrorState
            message={error ?? "Case not found"}
            onRetry={() => {
              setLoading(true);
              load().finally(() => setLoading(false));
            }}
          />
        ) : (
          <ScrollView
            contentContainerClassName="px-5 pt-4 pb-12"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#c5853a"
              />
            }
          >
            <Hero c={data.case} />

            <Animated.View entering={FadeInDown.duration(380).delay(80)}>
              <InfoGrid c={data.case} />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(140)}>
              <UpdateHearingCard
                caseId={data.case.id}
                initialDate={data.case.nextHearingDate?.slice(0, 10) || ""}
                initialStatus={data.case.status || "Filed"}
                onSaved={(updated) =>
                  setData((prev) =>
                    prev ? { ...prev, case: updated } : prev
                  )
                }
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(200)}>
              <ContactCard
                c={data.case}
                officeName={data.officeName}
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(260)}>
              <DocumentsPanel caseId={data.case.id} />
            </Animated.View>

            {data.case.hearings && data.case.hearings.length > 0 ? (
              <Animated.View entering={FadeInDown.duration(380).delay(320)}>
                <HistoryCard hearings={data.case.hearings} />
              </Animated.View>
            ) : null}

            <Animated.View entering={FadeInDown.duration(380).delay(380)}>
              <DisposePanel
                c={data.case}
                onChanged={(next) =>
                  setData((prev) =>
                    prev ? { ...prev, case: next } : prev
                  )
                }
              />
            </Animated.View>

            <Animated.View entering={FadeInDown.duration(380).delay(400)}>
              <Pressable
                onPress={() =>
                  router.push(`/(home)/cases/edit/${data.case.id}` as never)
                }
                className="mt-4 rounded-xl bg-app-paper p-4 flex-row items-center gap-3 active:opacity-85"
                style={{
                  shadowColor: "#0a1124",
                  shadowOpacity: 0.05,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 1 },
                  elevation: 1,
                }}
                accessibilityRole="button"
                accessibilityLabel="Edit this matter"
              >
                <View
                  className="h-9 w-9 items-center justify-center rounded-lg"
                  style={{ backgroundColor: "#efe5d0" }}
                >
                  <Feather name="edit-3" size={15} color="#8a5821" />
                </View>
                <View className="flex-1">
                  <Text
                    className="text-[14px] text-app-ink"
                    style={{ fontFamily: "Manrope-SemiBold" }}
                  >
                    Edit this matter
                  </Text>
                  <Text
                    className="text-[11px] mt-0.5 text-app-fg-muted"
                    style={{ fontFamily: "Manrope" }}
                  >
                    Change any detail — parties, court, dates, status.
                  </Text>
                </View>
                <Feather name="chevron-right" size={15} color="#8a5821" />
              </Pressable>
            </Animated.View>

            {/* "Duplicate this matter" used to sit here. Chambers asked
                for it gone: a pre-filled new case one tap from an open
                dossier was mostly a way to create a near-copy by
                accident, and a real second matter for the same client is
                started from the vault's New button anyway. The
                /cases/new?from= route stays registered so anything that
                still links to it keeps working. */}

            <Animated.View entering={FadeInDown.duration(380).delay(460)}>
              <DeleteRow
                caseId={data.case.id}
                caseNo={data.case.caseNo}
                onDeleted={onDeleted}
              />
            </Animated.View>
          </ScrollView>
        )}
    </View>
  );
}

/* ─── Hero ─── */

function Hero({ c }: { c: PartnerCase }) {
  const next = c.nextHearingDate ? new Date(c.nextHearingDate) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isOverdue = next && next < today;
  const isToday = next && next.toDateString() === new Date().toDateString();

  return (
    <Animated.View
      entering={FadeInDown.duration(420)}
      className="rounded-3xl overflow-hidden p-6"
      style={{
        backgroundColor: "#0a1124",
        shadowColor: "#0a1124",
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      }}
    >
      {c.fileNo ? (
        <Text
          className="text-[10px] uppercase"
          style={{
            fontFamily: "DMMono-Medium",
            letterSpacing: 2.2,
            color: "#c5853a",
          }}
        >
          File &middot; {c.fileNo}
        </Text>
      ) : null}
      <Text
        className="mt-1.5 text-[32px] font-semibold tracking-tight leading-[1.05]"
        style={{
          fontFamily: "Crimson-SemiBold",
          color: "#f5ebd6",
        }}
      >
        {c.caseNo}
      </Text>
      {c.cnr ? (
        <View className="mt-1.5">
          <CnrChip cnr={c.cnr} tone="dark" />
        </View>
      ) : null}

      {/* Parties */}
      {(c.clientName || c.oppositeParty) ? (
        <View className="mt-5">
          {c.clientName ? (
            <Text
              className="text-[18px] leading-[1.3]"
              style={{
                fontFamily: "Crimson-SemiBold",
                color: "#f5ebd6",
              }}
            >
              {c.clientName}
            </Text>
          ) : null}
          {c.oppositeParty ? (
            <View className="flex-row items-center gap-2 mt-1">
              <Text
                className="text-[10px] uppercase"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 2.2,
                  color: "#c5853a",
                }}
              >
                vs
              </Text>
              <Text
                className="text-[16px] flex-1"
                style={{
                  fontFamily: "Crimson-SemiBold",
                  color: "rgba(245,235,214,0.92)",
                }}
              >
                {c.oppositeParty}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Status + next date */}
      <View className="mt-5 flex-row items-end justify-between gap-3">
        <View
          className="rounded-md px-3 py-1.5"
          style={{ backgroundColor: "#c5853a", flexShrink: 1 }}
        >
          <Text
            className="text-[10px] font-semibold uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.8,
              color: "#2a1c08",
            }}
            numberOfLines={2}
          >
            {c.status || "Filed"}
          </Text>
        </View>
        {next ? (
          <View style={{ flexShrink: 0 }}>
            <Text
              className="text-[9px] uppercase text-right"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 2.2,
                color: "rgba(245,235,214,0.55)",
              }}
            >
              Next hearing
            </Text>
            <Text
              className="mt-0.5 text-[20px] font-semibold tabular-nums text-right"
              style={{
                fontFamily: "Crimson-SemiBold",
                color: isOverdue
                  ? "#ff8a8a"
                  : isToday
                    ? "#c5853a"
                    : "#f5ebd6",
              }}
            >
              {next.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </Text>
            {isToday ? (
              <Text
                className="text-[9px] uppercase text-right mt-0.5"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.8,
                  color: "#c5853a",
                }}
              >
                Today
              </Text>
            ) : isOverdue ? (
              <Text
                className="text-[9px] uppercase text-right mt-0.5"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.8,
                  color: "#ff8a8a",
                }}
              >
                Overdue
              </Text>
            ) : null}
          </View>
        ) : (
          <View
            className="rounded-md px-3 py-1.5"
            style={{
              flexShrink: 0,
              borderWidth: 1,
              borderColor: "rgba(245,235,214,0.2)",
              backgroundColor: "rgba(245,235,214,0.06)",
            }}
          >
            <Text
              className="text-[10px] font-semibold uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.8,
                color: "rgba(245,235,214,0.65)",
              }}
            >
              Pending date
            </Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/* ─── Info grid ─── */

function InfoGrid({ c }: { c: PartnerCase }) {
  return (
    <View className="mt-4 gap-3">
      <View className="flex-row gap-3">
        <InfoCard
          label="Court"
          primary={c.courtName || "—"}
          secondary={
            [c.courtHall, c.courtPlace].filter(Boolean).join(" · ") ||
            undefined
          }
        />
        <InfoCard
          label="Representation"
          primary={c.appearingFor ? `For ${c.appearingFor}` : "—"}
          secondary={
            c.oppositeAdvocate ? `vs ${c.oppositeAdvocate}` : undefined
          }
        />
      </View>
      <View className="flex-row gap-3">
        <InfoCard
          label="Previous date"
          primary={
            c.lastHearingDate
              ? formatDateForDisplay(c.lastHearingDate.slice(0, 10))
              : "—"
          }
          secondary={
            c.hearings && c.hearings.length > 0
              ? `${c.hearings.length} on record`
              : undefined
          }
        />
        <InfoCard label="I.A. Numbers" primary={c.iaNumbers || "—"} mono />
      </View>
    </View>
  );
}

function InfoCard({
  label,
  primary,
  secondary,
  mono,
}: {
  label: string;
  primary: string;
  secondary?: string;
  mono?: boolean;
}) {
  return (
    <View
      className="flex-1 rounded-2xl bg-app-paper p-4"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.04,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}
    >
      <Text
        className="text-[9px] uppercase text-app-fg-muted"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 2 }}
      >
        {label}
      </Text>
      <Text
        className="mt-1.5 text-[16px] font-semibold leading-[1.25] text-app-ink"
        style={{
          fontFamily: mono ? "DMMono-Medium" : "Crimson-SemiBold",
        }}
        numberOfLines={2}
      >
        {primary}
      </Text>
      {secondary ? (
        <Text
          className="mt-1 text-[11px] text-app-fg-muted"
          style={{ fontFamily: "Manrope" }}
          numberOfLines={1}
        >
          {secondary}
        </Text>
      ) : null}
    </View>
  );
}

/* ─── Update hearing ─── */

function UpdateHearingCard({
  caseId,
  initialDate,
  initialStatus,
  onSaved,
}: {
  caseId: string;
  initialDate: string;
  initialStatus: string;
  onSaved: (c: PartnerCase) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [status, setStatus] = useState(initialStatus);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty = date !== initialDate || status !== initialStatus;

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const res = await partnerUpdateCase(caseId, {
        nextHearingDate: date || null,
        status,
      });
      onSaved(res.case);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      className="mt-4 rounded-2xl bg-app-paper p-5"
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
      <View className="flex-row items-center justify-between mb-4">
        <Text
          className="text-[10px] uppercase text-app-copper-deep"
          style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
        >
          Update hearing
        </Text>
        {savedAt && !dirty ? (
          <Text
            className="text-[10px] uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.6,
              color: "#56a0a8",
            }}
          >
            Saved
          </Text>
        ) : null}
      </View>

      <View className="gap-4">
        <DateField
          label="Next hearing date"
          value={date}
          onChange={setDate}
        />
        <StatusCombobox
          label="Status / Stage"
          value={status}
          onChange={setStatus}
        />
      </View>

      {error ? (
        <View
          className="mt-4 rounded-md px-3 py-2"
          style={{ backgroundColor: "#f6dccd" }}
        >
          <Text
            className="text-[12px] text-app-ink"
            style={{ fontFamily: "Manrope" }}
          >
            {error}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={save}
        disabled={!dirty || saving}
        className="mt-5 rounded-md py-3.5 items-center justify-center flex-row gap-2"
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
            Save Update
          </Text>
        )}
      </Pressable>
    </View>
  );
}

/* ─── Contact ─── */

function ContactCard({
  c,
  officeName,
}: {
  c: PartnerCase;
  officeName: string;
}) {
  const hasAny = c.clientName || c.clientPhone || c.clientWhatsapp || c.clientAddress;

  async function callClient() {
    const phone = (c.clientPhone || c.clientWhatsapp).replace(/\s+/g, "");
    if (!phone) return;
    const url = `tel:${phone}`;
    const can = await Linking.canOpenURL(url);
    if (can) {
      Linking.openURL(url);
    } else {
      Alert.alert("Can't make calls from this device.");
    }
  }

  async function openWhatsApp() {
    const raw = (c.clientWhatsapp || c.clientPhone).replace(/\D/g, "");
    if (!raw) return;
    const wa = raw.length === 10 ? `91${raw}` : raw;

    const dateStr = c.nextHearingDate
      ? new Date(c.nextHearingDate).toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "the date communicated separately";

    const venue = [c.courtName, c.courtPlace].filter(Boolean).join(", ") ||
      "the Hon'ble Court";
    const office = officeName || "this office";
    const matter = c.oppositeParty
      ? `${c.clientName || "you"} vs ${c.oppositeParty}`
      : c.caseNo;

    const text = [
      `Dear Mr./Ms. ${c.clientName || "Client"},`,
      ``,
      `Warm greetings from ${office}.`,
      ``,
      `This is to formally apprise you that the next hearing in your matter ${c.caseNo}` +
        (c.oppositeParty ? ` (${matter})` : ``) +
        ` has been scheduled on ${dateStr} before the ${venue}.`,
      ``,
      `You are kindly requested to ensure your presence on the said date and time, accompanied by all relevant documents previously discussed, so as to enable us to proceed with your matter without procedural complication. Non-attendance may give rise to adverse consequences, including the issuance of warrants or ex-parte orders, which we wish to avoid in your interest.`,
      ``,
      `For any clarification or to revisit the brief prior to the hearing, please feel free to contact our office at your convenience.`,
      ``,
      `Thank you for your continued cooperation and trust.`,
      ``,
      `Regards,`,
      office,
    ].join("\n");

    const native = `whatsapp://send?phone=${wa}&text=${encodeURIComponent(text)}`;
    const fallback = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    try {
      const can = await Linking.canOpenURL(native);
      if (can) {
        await Linking.openURL(native);
      } else {
        await Linking.openURL(fallback);
      }
    } catch {
      try {
        await Linking.openURL(fallback);
      } catch {
        Alert.alert("Couldn't open WhatsApp.");
      }
    }
  }

  return (
    <View
      className="mt-4 rounded-2xl bg-app-paper p-5"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: "#56a0a8",
      }}
    >
      <Text
        className="text-[10px] uppercase text-app-copper-deep"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        Client contact
      </Text>

      {hasAny ? (
        <>
          <Text
            className="mt-3 text-[20px] font-semibold leading-[1.2] text-app-ink"
            style={{ fontFamily: "Crimson-SemiBold" }}
          >
            {c.clientName || "—"}
          </Text>
          {c.clientPhone ? (
            <Text
              className="mt-1 text-[13px] tabular-nums"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 0.5,
                color: "#4d4538",
              }}
            >
              {c.clientPhone}
            </Text>
          ) : null}
          {c.clientWhatsapp && c.clientWhatsapp !== c.clientPhone ? (
            <Text
              className="mt-0.5 text-[12px] tabular-nums"
              style={{
                fontFamily: "DMMono",
                letterSpacing: 0.5,
                color: "#8a5821",
              }}
            >
              WA · {c.clientWhatsapp}
            </Text>
          ) : null}
          {c.clientAddress ? (
            <Text
              className="mt-3 text-[13px] leading-[1.55] text-app-fg-soft"
              style={{ fontFamily: "Manrope" }}
            >
              {c.clientAddress}
            </Text>
          ) : null}

          <View className="mt-5 flex-row gap-3">
            <Pressable
              onPress={callClient}
              disabled={!c.clientPhone && !c.clientWhatsapp}
              className="flex-1 rounded-md py-3 items-center justify-center flex-row gap-2 active:opacity-80"
              style={{
                backgroundColor: "#0a1124",
                opacity: c.clientPhone || c.clientWhatsapp ? 1 : 0.4,
                shadowColor: "#0a1124",
                shadowOpacity: 0.18,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 3,
              }}
            >
              <Feather name="phone" size={14} color="#f5ebd6" />
              <Text
                className="text-[13px] font-semibold"
                style={{
                  fontFamily: "Manrope-SemiBold",
                  color: "#f5ebd6",
                }}
              >
                Call
              </Text>
            </Pressable>
            <Pressable
              onPress={openWhatsApp}
              disabled={!c.clientWhatsapp && !c.clientPhone}
              className="flex-1 rounded-md py-3 items-center justify-center flex-row gap-2 active:opacity-80"
              style={{
                backgroundColor: "#25d366",
                opacity: c.clientWhatsapp || c.clientPhone ? 1 : 0.4,
                shadowColor: "#25d366",
                shadowOpacity: 0.35,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
            >
              <FontAwesome name="whatsapp" size={15} color="#0b3d22" />
              <Text
                className="text-[13px] font-semibold"
                style={{
                  fontFamily: "Manrope-SemiBold",
                  color: "#0b3d22",
                }}
              >
                WhatsApp
              </Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text
          className="mt-3 text-[13px] leading-[1.55] text-app-fg-muted"
          style={{ fontFamily: "Manrope" }}
        >
          No client contact saved. Edit the matter to add a phone number and
          address — that will activate the Call and WhatsApp buttons.
        </Text>
      )}
    </View>
  );
}

/* ─── History ─── */

function HistoryCard({
  hearings,
}: {
  hearings: PartnerCase["hearings"];
}) {
  return (
    <View
      className="mt-4 rounded-2xl bg-app-paper p-5"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.04,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
      }}
    >
      <Text
        className="text-[10px] uppercase text-app-copper-deep"
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        Hearing history
      </Text>
      <View className="mt-3 gap-3">
        {hearings
          .slice()
          .reverse()
          .map((h, i) => {
            const date = h.date ? new Date(h.date) : null;
            const next = h.nextDate ? new Date(h.nextDate) : null;
            return (
              <View
                key={i}
                className="flex-row gap-4"
                style={{
                  paddingBottom: 10,
                  borderBottomWidth: i === hearings.length - 1 ? 0 : 1,
                  borderBottomColor: "#efe5d0",
                }}
              >
                <View style={{ width: 78 }}>
                  <Text
                    className="text-[14px] font-semibold tabular-nums text-app-ink"
                    style={{ fontFamily: "Crimson-SemiBold" }}
                  >
                    {date
                      ? date.toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                        })
                      : "—"}
                  </Text>
                  <Text
                    className="text-[10px] text-app-fg-muted tabular-nums"
                    style={{ fontFamily: "DMMono", letterSpacing: 0.4 }}
                  >
                    {date ? date.getFullYear() : ""}
                  </Text>
                </View>
                <View className="flex-1">
                  {h.status ? (
                    <View
                      className="self-start rounded px-1.5 py-0.5"
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
                        {h.status}
                      </Text>
                    </View>
                  ) : null}
                  {h.outcome ? (
                    <Text
                      className="mt-1.5 text-[12px] text-app-fg-soft"
                      style={{ fontFamily: "Manrope" }}
                    >
                      {h.outcome}
                    </Text>
                  ) : null}
                  {next ? (
                    <Text
                      className="mt-1 text-[10px] text-app-fg-muted"
                      style={{ fontFamily: "DMMono", letterSpacing: 0.4 }}
                    >
                      Adjourned to{" "}
                      {next.toLocaleDateString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                    </Text>
                  ) : null}
                </View>
              </View>
            );
          })}
      </View>
    </View>
  );
}

/* ─── Delete ─── */

function DeleteRow({
  caseId,
  caseNo,
  onDeleted,
}: {
  caseId: string;
  caseNo: string;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const { offerDeleteRequest, deleteRequestSheet } = useDeleteRequestFallback();

  function confirm() {
    Alert.alert(
      `Delete ${caseNo}?`,
      "The matter will be removed from the Case Vault, dashboard, and hearing track. This is a soft delete — recoverable on request.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await partnerDeleteCase(caseId);
              onDeleted();
            } catch (err) {
              setDeleting(false);
              // A non-admin can't delete directly — but they CAN ask.
              if (offerDeleteRequest(err)) return;
              Alert.alert(
                "Couldn't delete",
                err instanceof ApiError ? err.message : "Try again."
              );
            }
          },
        },
      ]
    );
  }

  return (
    <View className="mt-8 items-center">
      <Pressable
        onPress={confirm}
        disabled={deleting}
        className="rounded-md flex-row items-center gap-2 px-5 py-3 active:opacity-50"
        style={{
          borderWidth: 1,
          borderColor: "#c14a37",
          backgroundColor: "transparent",
          opacity: deleting ? 0.5 : 1,
        }}
      >
        {deleting ? (
          <ActivityIndicator color="#c14a37" size="small" />
        ) : (
          <Feather name="trash-2" size={14} color="#c14a37" />
        )}
        <Text
          className="text-[13px] font-medium"
          style={{ fontFamily: "Manrope-Medium", color: "#c14a37" }}
        >
          Delete this matter
        </Text>
      </Pressable>

      {deleteRequestSheet}
    </View>
  );
}

/* ─── Error ─── */

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: "#f6dccd" }}
      >
        <Feather name="alert-circle" size={22} color="#c14a37" />
      </View>
      <Text
        className="mt-4 text-[20px] font-semibold tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        Couldn&rsquo;t load the case
      </Text>
      <Text
        className="mt-2 text-[13px] text-app-fg-muted text-center"
        style={{ fontFamily: "Manrope" }}
      >
        {message}
      </Text>
      <Pressable
        onPress={onRetry}
        className="mt-5 rounded-md flex-row items-center gap-2 px-5 py-2.5 active:opacity-80"
        style={{ backgroundColor: "#0a1124" }}
      >
        <Feather name="refresh-ccw" size={13} color="#f5ebd6" />
        <Text
          className="text-[12px] font-semibold"
          style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
        >
          Try again
        </Text>
      </Pressable>
    </View>
  );
}
