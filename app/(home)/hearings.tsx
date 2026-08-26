import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Feather, FontAwesome } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import {
  partnerListHearings,
  partnerUpdateCase,
  partnerGetNoticeTemplate,
  partnerListCourts,
  ApiError,
  type HearingBucket,
  type PartnerCourt,
  type PartnerHearingItem,
} from "../../lib/api";
import {
  renderNotice,
  parseDateLocal,
  type NoticeData,
} from "../../lib/notice-template";
import { DateField } from "../../components/CaseFields";
import StatusCombobox from "../../components/cases/StatusCombobox";
import Sheet from "../../components/Sheet";
import DisposalFields, {
  EMPTY_DISPOSAL,
  todayLocal,
  type DisposalRecord,
} from "../../components/cases/DisposalFields";
import { useDeleteRequestFallback } from "../../components/useDeleteRequestFallback";
import CourtFilter, {
  buildCourtOptions,
  courtKeyOf,
} from "../../components/hearings/CourtFilter";
import CnrChip from "../../components/CnrChip";
import { caseHref } from "../../components/cases/useCaseOrigin";
import { useAuth } from "../../lib/auth-context";
import ExportSheet from "../../components/ExportSheet";
import {
  HEARING_EXPORT_BUCKETS,
  exportHearings,
  type HearingExportBucket,
} from "../../lib/exports";

const SEGMENTS: { key: HearingBucket; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "pending", label: "Pending" },
];

const STATUS_OPTIONS = [
  "Filed",
  "Notice",
  "Pleadings",
  "Issues",
  "Evidence",
  "Arguments",
  "Reserved",
  "Judgment",
  "Disposed",
];

// The three fields a hearing update can change on the record. A saved
// patch is held on the SCREEN, not inside the editor, so the card behind
// it — and the WhatsApp button on that card — describe the hearing that
// was just saved the instant Save succeeds. The list is only refetched on
// Done, which is what lets a freshly-dated matter stay put long enough to
// message the client before it leaves this bucket.
type SavedPatch = Pick<
  PartnerHearingItem,
  "status" | "nextHearingDate" | "lastHearingDate"
>;

// Takes the saved record from the server's response rather than
// re-deriving it: the PATCH also archives the old next-date into
// lastHearingDate, and the notice has to quote the same three fields the
// case file now holds.
function patchFromSavedCase(
  before: PartnerHearingItem,
  saved: {
    status?: string;
    nextHearingDate?: string | null;
    lastHearingDate?: string | null;
  } | null
): SavedPatch {
  return {
    status: saved?.status ?? before.status,
    nextHearingDate:
      saved && "nextHearingDate" in saved
        ? (saved.nextHearingDate ?? null)
        : before.nextHearingDate,
    lastHearingDate:
      saved && "lastHearingDate" in saved
        ? (saved.lastHearingDate ?? null)
        : before.nextHearingDate || before.lastHearingDate,
  };
}

// Disposing a matter is office-admin only on the server (it answers 403
// with delete_request_required for everyone else), so the disposal record
// only goes on the wire when the status is actually being set to
// "Disposed" — and only the admin is shown the fields at all.
function disposalPayload(
  status: string,
  d: DisposalRecord
): Record<string, unknown> {
  if (status.trim() !== "Disposed") return {};
  return {
    // Default the recorded date to today rather than leaving the archive
    // undated because someone skipped the field.
    disposalDate: d.disposalDate || todayLocal(),
    caStatus: d.caStatus.trim(),
    disposalRemarks: d.disposalRemarks.trim(),
    receivedByClient: d.receivedByClient,
  };
}

// Free-text narrowing over one loaded bucket. Every field a matter gets
// remembered by goes into the haystack — number, file number, CNR, both
// parties, the court, the stage, the client's numbers, and the two dates
// as they're stored — because an advocate looking for a matter has
// whichever one of those came to mind first, not a particular one.
//
// Words are ANDed in any order, so "murugan pdjk" finds that client in
// that court without caring which was typed first. Deliberately local: the
// bucket is already on the device, and reaching for the server would only
// return matters that don't belong to the tab being read.
function matchesQuery(c: PartnerHearingItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    c.caseNo,
    c.fileNo,
    c.cnr,
    c.clientName,
    c.oppositeParty,
    c.courtName,
    c.courtPlace,
    c.status,
    c.clientPhone,
    c.clientWhatsapp,
    c.nextHearingDate?.slice(0, 10),
    c.lastHearingDate?.slice(0, 10),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((term) => hay.includes(term));
}

export default function Hearings() {
  const { isPartnerAdmin } = useAuth();
  const router = useRouter();

  // The bucket lives in the URL, not in component state.
  //
  // It used to be useState synced from the route param by an effect. That
  // had two holes, and the dashboard fell through both: arriving with NO
  // param left whatever bucket the tab was last on (tapping "Today" landed
  // you on Tomorrow), and arriving with the SAME param as last time didn't
  // re-run the effect either (Today → switch to Pending by hand → Today
  // again = still Pending). Adding a param to the link would have fixed
  // one of those and left the other.
  //
  // With the URL as the single source of truth there is no second copy to
  // drift: every entry point lands on the bucket it asked for, and the
  // segmented control just rewrites the param.
  const { bucket: bucketParam } = useLocalSearchParams<{ bucket?: string }>();
  const bucket: HearingBucket =
    bucketParam === "tomorrow" || bucketParam === "pending"
      ? bucketParam
      : "today";

  const [items, setItems] = useState<PartnerHearingItem[]>([]);
  const [counts, setCounts] = useState({ today: 0, tomorrow: 0, pending: 0 });
  const [officeName, setOfficeName] = useState("");
  const [template, setTemplate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Export sheet state — the export bucket starts from whatever tab the
  // user is on but can be changed in the sheet (incl. "All", which only
  // exists server-side on the export endpoint).
  const [exporting, setExporting] = useState(false);
  const [exportBucket, setExportBucket] =
    useState<HearingExportBucket>("today");
  // Court roster — only for the serial numbers, so the filter reads the
  // same as Court Hub. Fetched once; the options themselves come from the
  // hearings actually loaded.
  const [courts, setCourts] = useState<PartnerCourt[]>([]);
  // Empty = every court. Several courts can be ticked at once.
  const [courtKeys, setCourtKeys] = useState<string[]>([]);
  // Free-text narrowing over the loaded bucket — case number, client,
  // court, CNR, file number, status, phone. Whatever the advocate
  // happens to remember about the matter.
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  // Rows whose hearing was saved in this session, keyed by case id. Applied
  // over the server list so a card keeps showing (and messaging) what was
  // just saved until Done refetches.
  const [savedPatches, setSavedPatches] = useState<Record<string, SavedPatch>>(
    {}
  );

  const allRows = useMemo(
    () =>
      items.map((c) => (savedPatches[c.id] ? { ...c, ...savedPatches[c.id] } : c)),
    [items, savedPatches]
  );

  // Options come from the WHOLE bucket, so narrowing to one court never
  // empties the picker you'd need to get back out of it.
  const courtOptions = useMemo(
    () => buildCourtOptions(allRows, courts),
    [allRows, courts]
  );

  const courtFiltered = useMemo(() => {
    if (courtKeys.length === 0) return allRows;
    const wanted = new Set(courtKeys);
    return allRows.filter((c) => wanted.has(courtKeyOf(c)));
  }, [allRows, courtKeys]);

  const view = useMemo(
    () => courtFiltered.filter((c) => matchesQuery(c, query)),
    [courtFiltered, query]
  );
  const updating = useMemo(
    () => view.find((c) => c.id === updatingId) ?? null,
    [view, updatingId]
  );

  const load = useCallback(
    async (b: HearingBucket) => {
      try {
        const data = await partnerListHearings(b);
        setItems(data.items);
        setCounts(data.counts);
        setOfficeName(data.officeName);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    },
    []
  );

  // One place handles every bucket change — the segmented control, a
  // dashboard tile, a deep link. They all arrive as a new `bucket`, so
  // they all get the spinner and a cleared patch set without each caller
  // having to remember.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSavedPatches({});
    setCourtKeys([]);
    setQuery("");
    (async () => {
      await load(bucket);
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [bucket, load]);

  // The office's WhatsApp notice template — fetched once; the WhatsApp button
  // fills it per matter. Falls back to the bilingual default if absent.
  useEffect(() => {
    partnerGetNoticeTemplate()
      .then((r) => setTemplate(r.template))
      .catch(() => {});
    partnerListCourts()
      .then((r) => setCourts(r.courts))
      // No roster just means unnumbered options — not a reason to fail.
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(bucket);
    }, [bucket, load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    // A deliberate refresh means the server list is the truth again.
    setSavedPatches({});
    await load(bucket);
    setRefreshing(false);
  }, [bucket, load]);

  function changeBucket(next: HearingBucket) {
    if (next === bucket) return;
    // Rewrite the param rather than holding a second copy of the bucket;
    // the effect above reacts to it exactly as it does to a deep link.
    router.setParams({ bucket: next });
  }

  // Save landed — hold the record locally so the card and its WhatsApp
  // button quote it immediately.
  const applyPatch = useCallback((id: string, patch: SavedPatch) => {
    setSavedPatches((prev) => ({ ...prev, [id]: patch }));
  }, []);

  // Done with this matter — drop the local copy and refetch so the row
  // re-buckets out of Today / Pending.
  const finishWith = useCallback(
    (id: string) => {
      setSavedPatches((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      load(bucket);
    },
    [bucket, load]
  );

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar
          onExport={
            isPartnerAdmin
              ? () => {
                  setExportBucket(bucket);
                  setExporting(true);
                }
              : null
          }
        />
        <Segmented bucket={bucket} onChange={changeBucket} counts={counts} />

        {items.length > 0 && !loading ? (
          <View className="px-5 pt-3 flex-row items-center gap-2">
            <SearchBox value={query} onChange={setQuery} />
            <CourtFilter
              options={courtOptions}
              selected={courtKeys}
              onChange={setCourtKeys}
              total={allRows.length}
            />
          </View>
        ) : null}

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          <ScrollView
            contentContainerClassName="px-5 pt-4 pb-6"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#c5853a"
              />
            }
          >
            {error ? (
              <View
                className="rounded-md px-4 py-3 mb-4"
                style={{
                  backgroundColor: "#f6dccd",
                  borderWidth: 1,
                  borderColor: "rgba(193,74,55,0.3)",
                }}
              >
                <Text
                  className="text-[13px]"
                  style={{ fontFamily: "Manrope", color: "#c14a37" }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {view.length === 0 ? (
              // "Nothing today" and "nothing that MATCHES today" are
              // different facts; saying the first when the second is true
              // would read as data loss.
              allRows.length > 0 && (query.trim() || courtKeys.length > 0) ? (
                <EmptyForFilters
                  query={query.trim()}
                  courtCount={courtKeys.length}
                  onClear={() => {
                    setQuery("");
                    setCourtKeys([]);
                  }}
                />
              ) : (
                <Empty bucket={bucket} />
              )
            ) : bucket === "pending" ? (
              <View className="gap-4">
                {view.map((c, i) => (
                  <Animated.View
                    key={c.id}
                    entering={FadeInDown.duration(380).delay(
                      Math.min(i, 10) * 35
                    )}
                  >
                    <PendingCard
                      c={c}
                      isPartnerAdmin={isPartnerAdmin}
                      officeName={officeName}
                      template={template}
                      saved={Boolean(savedPatches[c.id])}
                      onSaved={(patch) => applyPatch(c.id, patch)}
                      onDone={() => finishWith(c.id)}
                    />
                  </Animated.View>
                ))}
              </View>
            ) : (
              <View className="gap-3">
                {view.map((c, i) => (
                  <Animated.View
                    key={c.id}
                    entering={FadeInDown.duration(380).delay(
                      Math.min(i, 10) * 35
                    )}
                  >
                    <ScheduledRow
                      c={c}
                      bucket={bucket}
                      officeName={officeName}
                      template={template}
                      saved={Boolean(savedPatches[c.id])}
                      onUpdate={() => setUpdatingId(c.id)}
                    />
                  </Animated.View>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      <ExportSheet
        visible={exporting}
        onClose={() => setExporting(false)}
        eyebrow="Hearing Track"
        title="Export the cause list"
        contextLine={`Today ${counts.today} · Tomorrow ${counts.tomorrow} · Pending ${counts.pending}`}
        run={(format) => exportHearings(format, exportBucket)}
      >
        <Text
          className="text-[10px] uppercase text-app-copper-deep mb-2"
          style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
        >
          Hearings
        </Text>
        <View className="flex-row gap-2 mb-5">
          {HEARING_EXPORT_BUCKETS.map((b) => {
            const active = b.key === exportBucket;
            return (
              <Pressable
                key={b.key}
                onPress={() => setExportBucket(b.key)}
                className="flex-1 items-center rounded-lg py-2 active:opacity-85"
                style={{
                  backgroundColor: active ? "#0a1124" : "#ffffff",
                  borderWidth: 1,
                  borderColor: active ? "#0a1124" : "#e3d9c0",
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text
                  className="text-[12px]"
                  style={{
                    fontFamily: "Manrope-SemiBold",
                    color: active ? "#f5ebd6" : "#0a1124",
                  }}
                >
                  {b.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ExportSheet>

      <UpdateHearingSheet
        item={updating}
        isPartnerAdmin={isPartnerAdmin}
        officeName={officeName}
        template={template}
        onClose={() => setUpdatingId(null)}
        onSaved={(patch) => {
          if (updatingId) applyPatch(updatingId, patch);
        }}
        onDone={() => {
          const id = updatingId;
          setUpdatingId(null);
          if (id) finishWith(id);
        }}
      />
    </View>
  );
}

/* ─── Quick update (scheduled rows) ─── */

function UpdateHearingSheet({
  item,
  isPartnerAdmin,
  officeName,
  template,
  onClose,
  onSaved,
  onDone,
}: {
  item: PartnerHearingItem | null;
  isPartnerAdmin: boolean;
  officeName: string;
  template: string;
  onClose: () => void;
  onSaved: (patch: SavedPatch) => void;
  onDone: () => void;
}) {
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [disposal, setDisposal] = useState<DisposalRecord>(EMPTY_DISPOSAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSaved, setHasSaved] = useState(false);
  const { offerDeleteRequest, deleteRequestSheet } = useDeleteRequestFallback();
  // What the last save put on record. Re-editing compares against this
  // rather than the row we opened with, so the button doesn't stay lit on
  // a value that's already written.
  const [baseline, setBaseline] = useState({ date: "", status: "" });

  const itemId = item?.id ?? null;
  useEffect(() => {
    if (!item) return;
    const d = item.nextHearingDate ? item.nextHearingDate.slice(0, 10) : "";
    setDate(d);
    // Status starts blank — set consciously; left blank, the stored status is
    // kept. The disposal note opens only when the status is "Disposed".
    setStatus("");
    setBaseline({ date: d, status: item.status ?? "" });
    setDisposal(EMPTY_DISPOSAL);
    setError(null);
    setSaving(false);
    setHasSaved(false);
    // Re-arm only when a DIFFERENT matter is opened — the row object itself
    // changes identity on every save (the patch is applied above us), and
    // re-running then would wipe the form the moment it succeeded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  const statusChanged =
    status.trim().length > 0 && status.trim() !== baseline.status;
  const dirty = date !== baseline.date || statusChanged;

  async function save() {
    if (!item || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        // Clearing the date is allowed — the matter moves to Pending.
        nextHearingDate: date || null,
        ...disposalPayload(status, disposal),
      };
      // Blank status keeps whatever's on record; a typed status applies.
      if (status.trim()) payload.status = status.trim();
      const res = await partnerUpdateCase(item.id, payload);
      const patch = patchFromSavedCase(item, res.case ?? null);
      setBaseline({
        date: patch.nextHearingDate ? patch.nextHearingDate.slice(0, 10) : "",
        status: patch.status,
      });
      setHasSaved(true);
      onSaved(patch);
    } catch (err) {
      // Only the admin may dispose or reopen — the server answers with the
      // delete-request code, so offer that instead of a dead-end error.
      if (offerDeleteRequest(err)) {
        setSaving(false);
        return;
      }
      setError(err instanceof ApiError ? err.message : "Couldn't update");
    } finally {
      setSaving(false);
    }
  }

  // The notify block reads the SAME row the list behind the sheet now
  // renders, so the card and the message can't disagree about what was
  // saved.
  const showNotify = hasSaved && !dirty && Boolean(item);

  return (
    <Sheet
      visible={Boolean(item)}
      onClose={saving ? () => {} : onClose}
      eyebrow="Hearing Track"
      title={item?.caseNo ?? ""}
      showClose={!saving}
    >
      <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
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

        {item?.cnr ? (
          <View className="mb-3.5">
            <CnrChip cnr={item.cnr} />
          </View>
        ) : null}

        <DateField label="Next hearing date" value={date} onChange={setDate} />
        <View className="mt-3">
          <StatusCombobox
            label="Status"
            value={status}
            options={STATUS_OPTIONS}
            onChange={setStatus}
            multiline
          />
        </View>
        {status.trim() === "Disposed" ? (
          isPartnerAdmin ? (
            <View className="mt-4">
              <Text
                className="text-[10px] uppercase mb-2 text-app-copper-deep"
                style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
              >
                Disposal details
              </Text>
              <DisposalFields
                value={disposal}
                onChange={setDisposal}
                compact
              />
            </View>
          ) : (
            <View
              className="mt-3.5 rounded-md px-3.5 py-2.5"
              style={{ backgroundColor: "#faf6ee" }}
            >
              <Text
                className="text-[12.5px]"
                style={{ fontFamily: "Manrope", color: "#4d4538" }}
              >
                Only the office admin can dispose a matter. Save and
                you&rsquo;ll be offered a request for them to review.
              </Text>
            </View>
          )
        ) : null}
        <Text
          className="mt-2 text-[11px] text-app-fg-muted"
          style={{ fontFamily: "Manrope" }}
        >
          Leave the date empty to move the matter to Pending. Leave status blank
          to keep it as-is.
        </Text>

        <Pressable
          onPress={save}
          disabled={saving || (!dirty && hasSaved)}
          className="mt-5 rounded-xl items-center justify-center flex-row gap-2 active:opacity-90"
          style={{
            backgroundColor: !dirty && hasSaved ? "#efe5d0" : "#0a1124",
            paddingVertical: 14,
            shadowColor: "#0a1124",
            shadowOpacity: !dirty && hasSaved ? 0 : 0.22,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: !dirty && hasSaved ? 0 : 4,
          }}
          accessibilityRole="button"
          accessibilityLabel="Save hearing update"
        >
          {saving ? (
            <ActivityIndicator size="small" color="#f5ebd6" />
          ) : (
            <Feather
              name="check"
              size={15}
              color={!dirty && hasSaved ? "#4d4538" : "#f5ebd6"}
            />
          )}
          <Text
            className="text-[13.5px]"
            style={{
              fontFamily: "Manrope-SemiBold",
              color: !dirty && hasSaved ? "#4d4538" : "#f5ebd6",
            }}
          >
            {saving ? "Saving…" : hasSaved && !dirty ? "Saved" : "Save update"}
          </Text>
        </Pressable>

        {/* Saved — notify the client with what's now on record, then Done.
            The matter stays in the list behind this sheet until Done, so
            the message can go out before the row leaves the bucket. */}
        {showNotify && item ? (
          <View
            className="mt-5 rounded-xl p-4"
            style={{
              backgroundColor: "#faf6ee",
              borderWidth: 1,
              borderColor: "#e3d9c0",
            }}
          >
            <Text
              className="text-[10px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.6,
                color: "#8a5821",
              }}
            >
              Hearing saved — notify {item.clientName || "the client"}
            </Text>
            <View className="mt-3 flex-row gap-2">
              <CallPill
                c={item}
                hasNumber={Boolean(item.clientPhone || item.clientWhatsapp)}
              />
              <WhatsAppPill
                c={item}
                officeName={officeName}
                template={template}
                hasNumber={Boolean(item.clientWhatsapp || item.clientPhone)}
              />
            </View>
          </View>
        ) : null}

        {hasSaved ? (
          <Pressable
            onPress={onDone}
            className="mt-3 rounded-xl items-center justify-center flex-row gap-2 active:opacity-85"
            style={{
              paddingVertical: 13,
              backgroundColor: "#c5853a",
              shadowColor: "#c5853a",
              shadowOpacity: 0.3,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
            accessibilityRole="button"
            accessibilityLabel="Done with this matter"
          >
            <Text
              className="text-[13px]"
              style={{ fontFamily: "Manrope-SemiBold", color: "#2a1c08" }}
            >
              Done
            </Text>
            <Feather name="arrow-right" size={14} color="#2a1c08" />
          </Pressable>
        ) : null}
        <View style={{ height: 16 }} />
      </View>
      {deleteRequestSheet}
    </Sheet>
  );
}

/* ─── Top bar ─── */

function TopBar({ onExport }: { onExport?: (() => void) | null }) {
  const today = new Date().toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return (
    <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center justify-between">
      <View>
        <Text
          className="text-[10px] uppercase text-app-copper-deep"
          style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
        >
          The Diary · {today}
        </Text>
        <Text
          className="mt-0.5 text-[18px] font-semibold tracking-tight text-app-ink leading-none"
          style={{ fontFamily: "Crimson-SemiBold" }}
        >
          Hearing Track
        </Text>
      </View>
      {onExport ? (
        <Pressable
          onPress={onExport}
          hitSlop={6}
          className="rounded-md items-center justify-center active:opacity-70"
          style={{
            height: 36,
            width: 36,
            backgroundColor: "#ffffff",
            borderWidth: 1,
            borderColor: "#e3d9c0",
          }}
          accessibilityRole="button"
          accessibilityLabel="Export cause list"
        >
          <Feather name="download" size={15} color="#8a5821" />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Search ─── */

function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View
      className="flex-1 flex-row items-center gap-2 rounded-full bg-app-paper px-3"
      style={{
        paddingVertical: 4,
        borderWidth: 1,
        borderColor: value ? "#c5853a" : "#e3d9c0",
      }}
    >
      <Feather name="search" size={13} color="#a89c80" />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search this list"
        placeholderTextColor="#a89c80"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        className="flex-1 text-[13px] text-app-ink"
        style={{ fontFamily: "Manrope", paddingVertical: 0 }}
        accessibilityLabel="Search hearings"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChange("")}
          hitSlop={8}
          className="active:opacity-50"
          accessibilityRole="button"
          accessibilityLabel="Clear search"
        >
          <Feather name="x" size={13} color="#8a5821" />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Segmented ─── */

function Segmented({
  bucket,
  onChange,
  counts,
}: {
  bucket: HearingBucket;
  onChange: (s: HearingBucket) => void;
  counts: { today: number; tomorrow: number; pending: number };
}) {
  return (
    <View className="border-b border-app-edge-soft bg-app-canvas px-5 py-3">
      <View
        className="flex-row rounded-lg p-1"
        style={{ backgroundColor: "rgba(10,17,36,0.05)" }}
      >
        {SEGMENTS.map((s) => {
          const isActive = bucket === s.key;
          const count = counts[s.key];
          return (
            <Pressable
              key={s.key}
              onPress={() => onChange(s.key)}
              className="flex-1 rounded-md py-2 items-center active:opacity-90 flex-row justify-center gap-1.5"
              style={{
                backgroundColor: isActive ? "#0a1124" : "transparent",
              }}
            >
              <Text
                className="text-[12px] font-semibold"
                style={{
                  fontFamily: "Manrope-SemiBold",
                  color: isActive ? "#f5ebd6" : "#4d4538",
                }}
              >
                {s.label}
              </Text>
              {count > 0 ? (
                <View
                  className="rounded-full px-1.5"
                  style={{
                    backgroundColor: isActive
                      ? "#c5853a"
                      : "rgba(10,17,36,0.08)",
                    minWidth: 20,
                    alignItems: "center",
                  }}
                >
                  <Text
                    className="text-[10px] tabular-nums"
                    style={{
                      fontFamily: "DMMono-Medium",
                      color: isActive ? "#2a1c08" : "#7a7060",
                    }}
                  >
                    {count}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ─── Today/Tomorrow row ─── */

function ScheduledRow({
  c,
  bucket,
  officeName,
  template,
  saved,
  onUpdate,
}: {
  c: PartnerHearingItem;
  bucket: HearingBucket;
  officeName: string;
  template: string;
  // This matter's hearing was updated in this session and the list hasn't
  // been refetched yet — the row already shows the new date and status.
  saved: boolean;
  onUpdate: () => void;
}) {
  const router = useRouter();
  const courtLine = [c.courtName, c.courtPlace].filter(Boolean).join(", ");
  const hasPhone = Boolean(c.clientPhone || c.clientWhatsapp);
  const hasWa = Boolean(c.clientWhatsapp || c.clientPhone);

  function openCase() {
    // Carry the bucket along so backing out of the dossier returns to
    // this list, on this tab — not to the Case Vault.
    router.push(caseHref(c.id, "hearings", bucket) as never);
  }

  return (
    <View
      className="rounded-2xl bg-app-paper p-4"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: "#c5853a",
      }}
    >
      <Pressable onPress={openCase} className="active:opacity-70">
        <View className="flex-row items-baseline gap-2 flex-wrap">
          <Text
            className="text-[18px] font-semibold tracking-tight text-app-ink"
            style={{ fontFamily: "Crimson-SemiBold" }}
          >
            {c.caseNo}
          </Text>
          {saved ? (
            <View
              className="rounded-md px-1.5 py-0.5"
              style={{ backgroundColor: "#c5853a" }}
            >
              <Text
                className="text-[9px] uppercase"
                style={{
                  fontFamily: "DMMono-Medium",
                  letterSpacing: 1.2,
                  color: "#2a1c08",
                }}
              >
                Updated
              </Text>
            </View>
          ) : null}
          {c.status ? (
            <View
              className="rounded-md px-1.5 py-0.5"
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
                {c.status}
              </Text>
            </View>
          ) : null}
        </View>
        {(c.clientName || courtLine) ? (
          <Text
            className="mt-1.5 text-[13px]"
            style={{ fontFamily: "Manrope", color: "#4d4538" }}
            numberOfLines={2}
          >
            {c.clientName ? (
              <Text
                style={{ fontFamily: "Manrope-SemiBold", color: "#0a1124" }}
              >
                {c.clientName}
              </Text>
            ) : null}
            {c.clientName && courtLine ? (
              <Text style={{ color: "#8a5821" }}>{"  ·  "}</Text>
            ) : null}
            {courtLine ? (
              <Text style={{ color: "#7a7060" }}>{courtLine}</Text>
            ) : null}
          </Text>
        ) : null}
      </Pressable>

      {(c.fileNo || c.cnr) ? (
        <View
          className="mt-2 flex-row items-center flex-wrap"
          style={{ gap: 6 }}
        >
          {c.fileNo ? (
            <Text
              style={{
                fontFamily: "DMMono-Medium",
                fontSize: 11,
                color: "#a89c80",
                letterSpacing: 0.3,
              }}
            >
              File {c.fileNo}
            </Text>
          ) : null}
          {c.fileNo && c.cnr ? (
            <Text style={{ color: "#c5853a", fontSize: 11 }}>·</Text>
          ) : null}
          {c.cnr ? <CnrChip cnr={c.cnr} /> : null}
        </View>
      ) : null}

      {/* Action row */}
      <View className="mt-3.5 flex-row items-center gap-2">
        <CallButton c={c} hasNumber={hasPhone} />
        <WhatsAppButton
          c={c}
          officeName={officeName}
          template={template}
          hasNumber={hasWa}
        />
        <Pressable
          onPress={onUpdate}
          hitSlop={4}
          className="rounded-md items-center justify-center active:opacity-80"
          style={{
            height: 34,
            width: 34,
            backgroundColor: "#ffffff",
            borderWidth: 1,
            borderColor: "#e3d9c0",
          }}
          accessibilityRole="button"
          accessibilityLabel={`Update hearing for ${c.caseNo}`}
        >
          <Feather name="edit-2" size={13} color="#8a5821" />
        </Pressable>
        <Pressable
          onPress={openCase}
          className="ml-auto rounded-md flex-row items-center gap-1.5 px-4 py-2 active:opacity-90"
          style={{
            backgroundColor: "#c5853a",
            shadowColor: "#c5853a",
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}
        >
          <Text
            className="text-[12px] font-semibold"
            style={{ fontFamily: "Manrope-SemiBold", color: "#2a1c08" }}
          >
            Open
          </Text>
          <Feather name="chevron-right" size={13} color="#2a1c08" />
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Pending card ─── */

function PendingCard({
  c,
  isPartnerAdmin,
  officeName,
  template,
  saved,
  onSaved,
  onDone,
}: {
  c: PartnerHearingItem;
  isPartnerAdmin: boolean;
  officeName: string;
  template: string;
  saved: boolean;
  onSaved: (patch: SavedPatch) => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [disposal, setDisposal] = useState<DisposalRecord>(EMPTY_DISPOSAL);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { offerDeleteRequest, deleteRequestSheet } = useDeleteRequestFallback();

  const isDisposing = status.trim() === "Disposed";

  const hasPhone = Boolean(c.clientPhone || c.clientWhatsapp);
  const hasWa = Boolean(c.clientWhatsapp || c.clientPhone);

  async function update() {
    setError(null);
    // A matter being disposed is being closed, not re-listed — requiring a
    // next date there would be asking for a hearing that will never happen.
    if (!date && !isDisposing) {
      setError("Please pick a next hearing date.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        nextHearingDate: date || null,
        ...disposalPayload(status, disposal),
      };
      // Blank status keeps the matter's current status; a typed status applies.
      if (status.trim()) payload.status = status.trim();
      const res = await partnerUpdateCase(c.id, payload);
      // The card stays on screen carrying what was just saved, so the
      // WhatsApp button below quotes the new date immediately. Done is
      // what refetches and lets the matter leave Pending.
      onSaved(patchFromSavedCase(c, res.case ?? null));
    } catch (err) {
      // Disposing is admin-only server-side — offer the request rather
      // than a dead end.
      if (offerDeleteRequest(err)) return;
      setError(err instanceof ApiError ? err.message : "Couldn't update");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View
      className="rounded-2xl bg-app-paper p-5"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 },
        elevation: 2,
      }}
    >
      {/* Title row */}
      <View className="flex-row items-start gap-3">
        <Pressable
          onPress={() =>
            router.push(caseHref(c.id, "hearings", "pending") as never)
          }
          className="flex-1 active:opacity-70"
        >
          <Text
            className="text-[22px] font-semibold tracking-tight text-app-ink"
            style={{ fontFamily: "Crimson-SemiBold" }}
          >
            {c.caseNo}
          </Text>
          {c.clientName ? (
            <Text
              className="mt-1 text-[12px]"
              style={{ fontFamily: "Manrope-SemiBold", color: "#0a1124" }}
              numberOfLines={2}
            >
              {c.clientName}
            </Text>
          ) : null}
          {(c.fileNo || c.cnr) ? (
            <View
              className="mt-1.5 flex-row items-center flex-wrap"
              style={{ gap: 6 }}
            >
              {c.fileNo ? (
                <Text
                  style={{
                    fontFamily: "DMMono-Medium",
                    fontSize: 11,
                    color: "#a89c80",
                    letterSpacing: 0.3,
                  }}
                >
                  File {c.fileNo}
                </Text>
              ) : null}
              {c.fileNo && c.cnr ? (
                <Text style={{ color: "#c5853a", fontSize: 11 }}>·</Text>
              ) : null}
              {c.cnr ? <CnrChip cnr={c.cnr} /> : null}
            </View>
          ) : null}
          {c.lastHearingDate ? (
            <Text
              className="mt-1 text-[11px]"
              style={{
                fontFamily: "DMMono",
                color: "#7a7060",
                letterSpacing: 0.4,
              }}
            >
              Last date:{" "}
              <Text style={{ color: "#0a1124", fontFamily: "DMMono-Medium" }}>
                {c.lastHearingDate.slice(0, 10)}
              </Text>
            </Text>
          ) : null}
        </Pressable>
        <View
          className="rounded-md px-2 py-1"
          style={{ backgroundColor: saved ? "#d2e6e7" : "#c5853a" }}
        >
          <Text
            className="text-[9px] font-semibold uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.5,
              color: saved ? "#2f6b70" : "#2a1c08",
            }}
          >
            {saved ? "Updated" : "Pending date"}
          </Text>
        </View>
      </View>

      {/* Update form */}
      <View className="mt-4 gap-3">
        <DateField
          label="Next hearing"
          value={date}
          onChange={setDate}
        />
        <StatusCombobox
          label="Status"
          value={status}
          options={STATUS_OPTIONS}
          onChange={setStatus}
          multiline
        />

        {/* Setting a matter to Disposed closes it — the disposal record
            belongs here, at the moment that's decided, not on a separate
            trip to the case page. */}
        {isDisposing ? (
          isPartnerAdmin ? (
            <View
              className="rounded-xl px-3.5 py-3"
              style={{
                backgroundColor: "#faf6ee",
                borderWidth: 1,
                borderColor: "#e3d9c0",
              }}
            >
              <Text
                className="text-[10px] uppercase mb-2 text-app-copper-deep"
                style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
              >
                Disposal details
              </Text>
              <DisposalFields
                value={disposal}
                onChange={setDisposal}
                compact
              />
            </View>
          ) : (
            <View
              className="rounded-md px-3.5 py-2.5"
              style={{ backgroundColor: "#faf6ee" }}
            >
              <Text
                className="text-[12.5px]"
                style={{ fontFamily: "Manrope", color: "#4d4538" }}
              >
                Only the office admin can dispose a matter. Update and
                you&rsquo;ll be offered a request for them to review.
              </Text>
            </View>
          )
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
          onPress={update}
          disabled={saving}
          className="rounded-md py-3 items-center justify-center flex-row gap-2"
          style={{
            backgroundColor: "#c5853a",
            opacity: saving ? 0.6 : 1,
            shadowColor: "#c5853a",
            shadowOpacity: 0.3,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          {saving ? (
            <ActivityIndicator color="#2a1c08" size="small" />
          ) : (
            <Text
              className="text-[13px] font-semibold"
              style={{ fontFamily: "Manrope-SemiBold", color: "#2a1c08" }}
            >
              {saved ? "Saved ✓ · update again" : "Update"}
            </Text>
          )}
        </Pressable>
      </View>

      {/* Contact buttons — after a save these quote the NEW date, because
          the card is rendering the saved record. */}
      {saved ? (
        <Text
          className="mt-4 text-[10px] uppercase"
          style={{
            fontFamily: "DMMono-Medium",
            letterSpacing: 1.6,
            color: "#8a5821",
          }}
        >
          Hearing saved — notify {c.clientName || "the client"}
        </Text>
      ) : null}
      <View className={saved ? "mt-2 flex-row gap-2" : "mt-4 flex-row gap-2"}>
        <CallPill c={c} hasNumber={hasPhone} />
        <WhatsAppPill
          c={c}
          officeName={officeName}
          template={template}
          hasNumber={hasWa}
        />
      </View>

      {deleteRequestSheet}

      {saved ? (
        <Pressable
          onPress={onDone}
          className="mt-3 rounded-md py-3 items-center justify-center flex-row gap-2 active:opacity-85"
          style={{ backgroundColor: "#0a1124" }}
          accessibilityRole="button"
          accessibilityLabel="Done with this matter"
        >
          <Text
            className="text-[13px]"
            style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
          >
            Done
          </Text>
          <Feather name="arrow-right" size={14} color="#f5ebd6" />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── Buttons ─── */

function CallButton({
  c,
  hasNumber,
}: {
  c: PartnerHearingItem;
  hasNumber: boolean;
}) {
  return (
    <Pressable
      onPress={() => callClient(c, hasNumber)}
      className="h-10 w-10 rounded-full items-center justify-center active:opacity-80"
      style={{
        backgroundColor: hasNumber ? "#0a1124" : "#a89c80",
        shadowColor: hasNumber ? "#0a1124" : "transparent",
        shadowOpacity: hasNumber ? 0.25 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: hasNumber ? 3 : 0,
      }}
    >
      <Feather name="phone" size={17} color="#f5ebd6" />
    </Pressable>
  );
}

function WhatsAppButton({
  c,
  officeName,
  template,
  hasNumber,
}: {
  c: PartnerHearingItem;
  officeName: string;
  template: string;
  hasNumber: boolean;
}) {
  return (
    <Pressable
      onPress={() => openWhatsApp(c, officeName, template, hasNumber)}
      className="h-10 w-10 rounded-full items-center justify-center active:opacity-80"
      style={{
        backgroundColor: hasNumber ? "#1faa4f" : "#9bbfa8",
        shadowColor: hasNumber ? "#1faa4f" : "transparent",
        shadowOpacity: hasNumber ? 0.35 : 0,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 3 },
        elevation: hasNumber ? 4 : 0,
      }}
    >
      <FontAwesome name="whatsapp" size={18} color="#ffffff" />
    </Pressable>
  );
}

function CallPill({
  c,
  hasNumber,
}: {
  c: PartnerHearingItem;
  hasNumber: boolean;
}) {
  return (
    <Pressable
      onPress={() => callClient(c, hasNumber)}
      className="flex-1 rounded-md py-2.5 items-center justify-center flex-row gap-2 active:opacity-80"
      style={{
        backgroundColor: hasNumber ? "#0a1124" : "#a89c80",
        shadowColor: hasNumber ? "#0a1124" : "transparent",
        shadowOpacity: hasNumber ? 0.18 : 0,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: hasNumber ? 3 : 0,
      }}
    >
      <Feather name="phone" size={14} color="#f5ebd6" />
      <Text
        className="text-[12px] font-semibold"
        style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
      >
        Call
      </Text>
    </Pressable>
  );
}

function WhatsAppPill({
  c,
  officeName,
  template,
  hasNumber,
}: {
  c: PartnerHearingItem;
  officeName: string;
  template: string;
  hasNumber: boolean;
}) {
  return (
    <Pressable
      onPress={() => openWhatsApp(c, officeName, template, hasNumber)}
      className="flex-1 rounded-md py-2.5 items-center justify-center flex-row gap-2 active:opacity-80"
      style={{
        backgroundColor: hasNumber ? "#1faa4f" : "#9bbfa8",
        shadowColor: hasNumber ? "#1faa4f" : "transparent",
        shadowOpacity: hasNumber ? 0.3 : 0,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: hasNumber ? 4 : 0,
      }}
    >
      <FontAwesome name="whatsapp" size={15} color="#ffffff" />
      <Text
        className="text-[12px] font-semibold"
        style={{ fontFamily: "Manrope-SemiBold", color: "#ffffff" }}
      >
        WhatsApp
      </Text>
    </Pressable>
  );
}

/* ─── Actions ─── */

async function callClient(c: PartnerHearingItem, hasNumber: boolean) {
  if (!hasNumber) {
    Alert.alert(
      "No phone number on file",
      "Add a phone or WhatsApp number on this case, or in Client Crew."
    );
    return;
  }
  const target = (c.clientPhone || c.clientWhatsapp).replace(/\s+/g, "");
  const url = `tel:${target}`;
  try {
    const can = await Linking.canOpenURL(url);
    if (can) {
      await Linking.openURL(url);
    } else {
      Alert.alert("Can't make calls from this device.");
    }
  } catch {
    Alert.alert("Couldn't open the dialer.");
  }
}

async function openWhatsApp(
  c: PartnerHearingItem,
  officeName: string,
  template: string,
  hasNumber: boolean
) {
  if (!hasNumber) {
    Alert.alert(
      "No WhatsApp number on file",
      "Add a WhatsApp or phone number on this case, or in Client Crew."
    );
    return;
  }
  const raw = (c.clientWhatsapp || c.clientPhone).replace(/\D/g, "");
  if (!raw) return;
  const wa = raw.length === 10 ? `91${raw}` : raw;

  // The wording comes from the office's editable bilingual template, filled
  // with this matter's details (My Profile → Pre-filled WhatsApp message).
  const data: NoticeData = {
    caseNo: c.caseNo || "",
    clientName: c.clientName || "",
    cnr: c.cnr || "",
    fileNo: c.fileNo || "",
    status: c.status || "",
    oppositeParty: c.oppositeParty || "",
    courtName: c.courtName || "",
    courtPlace: c.courtPlace || "",
    lastHearingDate: parseDateLocal(c.lastHearingDate),
    nextHearingDate: parseDateLocal(c.nextHearingDate),
    officeName: officeName || "",
  };
  const text = renderNotice(template, data);

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

/* ─── Empty ─── */

function EmptyForFilters({
  query,
  courtCount,
  onClear,
}: {
  query: string;
  courtCount: number;
  onClear: () => void;
}) {
  const searching = query.length > 0;
  return (
    <View className="items-center pt-12">
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Feather name={searching ? "search" : "home"} size={20} color="#8a5821" />
      </View>
      <Text
        className="mt-4 text-[20px] font-semibold tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        {searching ? "No matches." : "Nothing in these courts."}
      </Text>
      <Text
        className="mt-1.5 text-[12px] text-app-fg-muted text-center max-w-[290px]"
        style={{ fontFamily: "Manrope" }}
      >
        {searching ? (
          <>
            Nothing on this list answers to{" "}
            <Text
              style={{ fontFamily: "Manrope-SemiBold", color: "#0a1124" }}
            >
              “{query}”
            </Text>
            {courtCount > 0
              ? ` in the ${courtCount === 1 ? "court" : `${courtCount} courts`} you picked.`
              : "."}
          </>
        ) : (
          "Other courts have matters listed — clear the filter to see them."
        )}
      </Text>
      <Pressable
        onPress={onClear}
        className="mt-4 rounded-full px-4 py-2 active:opacity-80"
        style={{ backgroundColor: "#0a1124" }}
        accessibilityRole="button"
      >
        <Text
          className="text-[12px]"
          style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
        >
          Show the whole list
        </Text>
      </Pressable>
    </View>
  );
}

function Empty({ bucket }: { bucket: HearingBucket }) {
  const messages: Record<HearingBucket, { title: string; body: string }> = {
    today: {
      title: "Nothing on the cause-list today.",
      body: "When a matter has its next hearing date set to today, it will surface here.",
    },
    tomorrow: {
      title: "Tomorrow looks clear.",
      body: "No matters listed for tomorrow yet — a quiet day to plan ahead.",
    },
    pending: {
      title: "No pending dates.",
      body: "Every matter in the vault has its next hearing date set. Well kept.",
    },
  };
  const m = messages[bucket];

  return (
    <View className="items-center pt-12">
      <View
        className="h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Feather name="calendar" size={20} color="#8a5821" />
      </View>
      <Text
        className="mt-4 text-[20px] font-semibold tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        {m.title}
      </Text>
      <Text
        className="mt-1.5 text-[12px] text-app-fg-muted text-center max-w-[280px]"
        style={{ fontFamily: "Manrope" }}
      >
        {m.body}
      </Text>
    </View>
  );
}
