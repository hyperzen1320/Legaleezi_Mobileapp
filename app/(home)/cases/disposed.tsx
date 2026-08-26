import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { FlashList } from "@shopify/flash-list";
import {
  ApiError,
  partnerListDisposedCases,
  partnerUpdateCase,
  partnerDeleteCase,
  partnerBulkDeleteCases,
  partnerBulkRestoreCases,
  type DisposedCase,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import ExportSheet from "../../../components/ExportSheet";
import ConfirmSheet from "../../../components/ConfirmSheet";
import CnrChip from "../../../components/CnrChip";
import DisposalSummary from "../../../components/cases/DisposalSummary";
import {
  CASE_EXPORT_COLUMNS,
  DISPOSED_EXPORT_DEFAULT_KEYS,
  exportCases,
} from "../../../lib/exports";
import { useDeleteRequestFallback } from "../../../components/useDeleteRequestFallback";

// The archive — closed matters, newest disposal first (server caps at
// 500). Reopening moves the matter back to the vault by flipping its
// status away from "Disposed" (admin-only on the server, so the button
// only renders for the office admin).

export default function DisposedCases() {
  const { offerDeleteRequest, deleteRequestSheet } =
    useDeleteRequestFallback();
  const router = useRouter();
  const { isPartnerAdmin } = useAuth();
  const [cases, setCases] = useState<DisposedCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [exporting, setExporting] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  // A disposed matter keeps its CNR locked while it sits here; deleting it
  // removes it from the database for good and frees the CNR for re-use.
  const [deleteTarget, setDeleteTarget] = useState<DisposedCase | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  // Multi-select — admin bulk restore / permanent delete over the archive.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<null | "restore" | "delete">(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await partnerListDisposedCases();
      setCases(res.cases);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return cases;
    return cases.filter(
      (c) =>
        c.caseNo.toLowerCase().includes(q) ||
        c.fileNo.toLowerCase().includes(q) ||
        (c.cnr || "").toLowerCase().includes(q) ||
        (c.clientName || "").toLowerCase().includes(q) ||
        (c.oppositeParty || "").toLowerCase().includes(q) ||
        (c.courtName || "").toLowerCase().includes(q)
    );
  }, [cases, query]);

  function confirmReopen(c: DisposedCase) {
    Alert.alert(
      "Reopen this matter?",
      `${c.caseNo} moves back to the Case Vault with status “Filed” — adjust it from the case page after.`,
      [
        { text: "Keep archived", style: "cancel" },
        { text: "Reopen", onPress: () => void reopen(c) },
      ]
    );
  }

  async function reopen(c: DisposedCase) {
    setReopeningId(c.id);
    try {
      await partnerUpdateCase(c.id, { status: "Filed" });
      await load();
    } catch (err) {
      Alert.alert(
        "Couldn't reopen",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setReopeningId(null);
    }
  }

  async function runDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await partnerDeleteCase(deleteTarget.id);
      setCases((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      setDeleteTarget(null);
      if (offerDeleteRequest(err)) return;
      Alert.alert(
        "Couldn't delete",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setDeleteBusy(false);
    }
  }

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id));
  // FlashList recycles rows — feed it a signature so checkboxes repaint.
  const selectionSig = selectMode
    ? Array.from(selectedIds).sort().join(",")
    : "";

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (filtered.length > 0 && filtered.every((c) => prev.has(c.id))) {
        filtered.forEach((c) => next.delete(c.id));
      } else {
        filtered.forEach((c) => next.add(c.id));
      }
      return next;
    });
  }
  function exitSelect() {
    setSelectMode(false);
    setSelectedIds(new Set());
  }

  async function runBulkRestore() {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy("restore");
    try {
      await partnerBulkRestoreCases({ ids: Array.from(selectedIds) });
      await load();
      exitSelect();
    } catch (err) {
      Alert.alert(
        "Couldn't restore",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setBulkBusy(null);
    }
  }

  async function runBulkDelete() {
    if (selectedIds.size === 0 || bulkBusy) return;
    setBulkBusy("delete");
    try {
      await partnerBulkDeleteCases({ ids: Array.from(selectedIds) });
      await load();
      setConfirmBulkDelete(false);
      exitSelect();
    } catch (err) {
      Alert.alert(
        "Couldn't delete",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setBulkBusy(null);
    }
  }

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Top bar */}
        <View className="border-b border-app-edge bg-app-canvas px-4 py-3 flex-row items-center" style={{ gap: 10 }}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
            style={{ backgroundColor: "#ffffff" }}
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={17} color="#0a1124" />
          </Pressable>
          <View className="flex-1">
            <Text
              className="text-[10px] uppercase text-app-copper-deep"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
            >
              The Archive
            </Text>
            <View className="flex-row items-baseline gap-2 mt-0.5">
              <Text
                className="text-[18px] tracking-tight text-app-ink leading-none"
                style={{ fontFamily: "Crimson-SemiBold" }}
              >
                Disposed Cases
              </Text>
              {cases.length > 0 ? (
                <Text
                  className="text-[11px] text-app-fg-muted tabular-nums"
                  style={{ fontFamily: "DMMono", letterSpacing: 0.5 }}
                >
                  · {cases.length}
                </Text>
              ) : null}
            </View>
          </View>
          {isPartnerAdmin ? (
            <>
              <Pressable
                onPress={() => (selectMode ? exitSelect() : setSelectMode(true))}
                hitSlop={6}
                className="rounded-md items-center justify-center active:opacity-70"
                style={{
                  height: 36,
                  paddingHorizontal: 12,
                  backgroundColor: selectMode ? "#0a1124" : "#ffffff",
                  borderWidth: 1,
                  borderColor: selectMode ? "#0a1124" : "#e3d9c0",
                }}
                accessibilityRole="button"
                accessibilityLabel={
                  selectMode ? "Cancel selection" : "Select matters"
                }
              >
                <Text
                  className="text-[11px] uppercase"
                  style={{
                    fontFamily: "DMMono-Medium",
                    letterSpacing: 1.2,
                    color: selectMode ? "#f5ebd6" : "#8a5821",
                  }}
                >
                  {selectMode ? "Cancel" : "Select"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setExporting(true)}
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
                accessibilityLabel="Export disposed cases"
              >
                <Feather name="download" size={15} color="#8a5821" />
              </Pressable>
            </>
          ) : null}
        </View>

        {/* Search */}
        <View className="px-5 pt-4 pb-2 bg-app-canvas">
          <View
            className="flex-row items-center gap-2 rounded-xl bg-app-paper px-3.5 py-2.5"
            style={{
              shadowColor: "#0a1124",
              shadowOpacity: 0.04,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 1 },
              elevation: 1,
            }}
          >
            <Feather name="search" size={15} color="#a89c80" />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search the archive..."
              placeholderTextColor="#a89c80"
              autoCapitalize="none"
              autoCorrect={false}
              className="flex-1 text-[14px] text-app-ink"
              style={{ fontFamily: "Manrope", paddingVertical: 0 }}
            />
            {query.length > 0 ? (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                className="active:opacity-50"
              >
                <Feather name="x" size={15} color="#8a5821" />
              </Pressable>
            ) : null}
          </View>
        </View>

        {selectMode ? (
          <View
            className="mx-5 mt-1 mb-1 rounded-xl px-3.5 py-3"
            style={{ backgroundColor: "#0a1124", gap: 11 }}
          >
            {/* Tier 1 — select-all toggle + live count. Splitting the bar in
                two means the action buttons below always have the full width,
                so Delete can never run off the right edge. */}
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={toggleSelectAll}
                hitSlop={8}
                className="flex-row items-center active:opacity-70"
                style={{ gap: 9 }}
              >
                <View
                  className="h-5 w-5 items-center justify-center rounded-[5px] border"
                  style={{
                    borderColor: allFilteredSelected ? "#c5853a" : "#5b6373",
                    backgroundColor: allFilteredSelected
                      ? "#c5853a"
                      : "transparent",
                  }}
                >
                  {allFilteredSelected ? (
                    <Feather name="check" size={13} color="#2a1c08" />
                  ) : null}
                </View>
                <Text
                  className="text-[12px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
                >
                  {allFilteredSelected ? "Deselect all" : "Select all"}
                </Text>
              </Pressable>
              <Text
                className="text-[11px] tabular-nums"
                style={{
                  fontFamily: "DMMono-Medium",
                  color: "#ddb074",
                  letterSpacing: 0.4,
                }}
              >
                {selectedIds.size} selected
              </Text>
            </View>
            {/* Tier 2 — actions share the row width evenly */}
            <View className="flex-row" style={{ gap: 10 }}>
              <Pressable
                onPress={runBulkRestore}
                disabled={selectedIds.size === 0 || bulkBusy !== null}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 active:opacity-80"
                style={{
                  backgroundColor: "#efe5d0",
                  opacity: selectedIds.size === 0 || bulkBusy ? 0.5 : 1,
                }}
              >
                {bulkBusy === "restore" ? (
                  <ActivityIndicator size="small" color="#8a5821" />
                ) : (
                  <Feather name="rotate-ccw" size={13} color="#8a5821" />
                )}
                <Text
                  className="text-[12px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
                >
                  Restore
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setConfirmBulkDelete(true)}
                disabled={selectedIds.size === 0 || bulkBusy !== null}
                className="flex-1 flex-row items-center justify-center gap-1.5 rounded-lg py-2.5 active:opacity-80"
                style={{
                  backgroundColor: "#c14a37",
                  opacity: selectedIds.size === 0 || bulkBusy ? 0.5 : 1,
                }}
              >
                <Feather name="trash-2" size={13} color="#ffffff" />
                <Text
                  className="text-[12px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#ffffff" }}
                >
                  Delete
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          <Animated.View entering={FadeInDown.duration(380)} className="flex-1">
            <FlashList
              data={filtered}
              keyExtractor={(c) => c.id}
              extraData={selectionSig}
              renderItem={({ item }) => (
                <DisposedRow
                  c={item}
                  reopening={reopeningId === item.id}
                  selectMode={selectMode}
                  selected={selectedIds.has(item.id)}
                  onToggleSelect={() => toggleSelect(item.id)}
                  onReopen={
                    isPartnerAdmin && !selectMode
                      ? () => confirmReopen(item)
                      : null
                  }
                  onDelete={
                    isPartnerAdmin && !selectMode
                      ? () => setDeleteTarget(item)
                      : null
                  }
                  onOpen={() =>
                    router.push(`/(home)/cases/${item.id}` as never)
                  }
                />
              )}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 24,
              }}
              ItemSeparatorComponent={RowGap}
              ListHeaderComponent={
                error ? (
                  <View
                    className="rounded-md px-4 py-3 mb-4"
                    style={{ backgroundColor: "#f6dccd" }}
                  >
                    <Text
                      className="text-[13px]"
                      style={{ fontFamily: "Manrope", color: "#c14a37" }}
                    >
                      {error}
                    </Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={<EmptyArchive searching={Boolean(query)} />}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  tintColor="#c5853a"
                />
              }
            />
          </Animated.View>
        )}
      </SafeAreaView>

      <ExportSheet
        visible={exporting}
        onClose={() => setExporting(false)}
        eyebrow="The Archive"
        title="Export disposed cases"
        contextLine={`${cases.length} closed matters`}
        columns={{
          catalog: CASE_EXPORT_COLUMNS,
          defaultKeys: DISPOSED_EXPORT_DEFAULT_KEYS,
        }}
        run={(format, columnKeys) =>
          exportCases(format, {
            filters: { scope: "disposed" },
            columns: columnKeys,
          })
        }
      />

      <ConfirmSheet
        visible={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={runDelete}
        busy={deleteBusy}
        title="Delete this matter?"
        message={`${
          deleteTarget?.caseNo ?? "This matter"
        } leaves the archive and the database for good, freeing its CNR for re-use. This can't be undone.`}
        confirmLabel="Delete"
      />

      <ConfirmSheet
        visible={confirmBulkDelete}
        onClose={() => setConfirmBulkDelete(false)}
        onConfirm={runBulkDelete}
        busy={bulkBusy === "delete"}
        title={`Delete ${selectedIds.size} matter${
          selectedIds.size === 1 ? "" : "s"
        }?`}
        message={`${selectedIds.size} archived ${
          selectedIds.size === 1 ? "matter leaves" : "matters leave"
        } the database for good, freeing ${
          selectedIds.size === 1 ? "its CNR" : "their CNRs"
        } for re-use. This can't be undone.`}
        confirmLabel="Delete"
      />

      {deleteRequestSheet}
    </View>
  );
}

function RowGap() {
  return <View style={{ height: 12 }} />;
}

function DisposedRow({
  c,
  reopening,
  onReopen,
  onDelete,
  onOpen,
  selectMode,
  selected,
  onToggleSelect,
}: {
  c: DisposedCase;
  reopening: boolean;
  onReopen: (() => void) | null;
  onDelete: (() => void) | null;
  onOpen: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const disposedIso = c.disposalDate ?? c.disposedAt;
  const disposedOn = disposedIso
    ? new Date(disposedIso).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
    : "—";
  const courtLine = [c.courtName, c.courtPlace].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={selectMode ? onToggleSelect : onOpen}
      className="rounded-xl p-4 active:opacity-90"
      style={{
        backgroundColor: selected ? "#efe5d0" : "#faf6ee",
        shadowColor: "#0a1124",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: selected ? "#c5853a" : "#7e7763",
      }}
      accessibilityRole="button"
      accessibilityLabel={`Disposed case ${c.caseNo}`}
    >
      <View className="flex-row" style={{ gap: 12 }}>
        {selectMode ? (
          <View
            className="mt-0.5 h-5 w-5 items-center justify-center rounded-[5px] border"
            style={{
              borderColor: selected ? "#c5853a" : "#cfc4a8",
              backgroundColor: selected ? "#c5853a" : "transparent",
            }}
          >
            {selected ? (
              <Feather name="check" size={13} color="#2a1c08" />
            ) : null}
          </View>
        ) : null}
        <View className="flex-1">
      <View className="flex-row items-baseline gap-2 flex-wrap">
        <Text
          className="text-[17px] tracking-tight text-app-ink"
          style={{ fontFamily: "Crimson-SemiBold" }}
        >
          {c.caseNo}
        </Text>
        {c.fileNo ? (
          <Text
            className="text-[10px] text-app-fg-muted"
            style={{ fontFamily: "DMMono", letterSpacing: 0.4 }}
          >
            {c.fileNo}
          </Text>
        ) : null}
        {/* Disposal stamp */}
        <View
          className="rounded-sm px-1.5 py-0.5 ml-auto"
          style={{
            borderWidth: 1,
            borderColor: "rgba(126,119,99,0.55)",
            transform: [{ rotate: "-2deg" }],
          }}
        >
          <Text
            className="text-[9px] uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.4,
              color: "#7e7763",
            }}
          >
            Disposed {disposedOn}
          </Text>
        </View>
      </View>

      {(c.clientName || c.oppositeParty) ? (
        <Text
          className="mt-2 text-[13px] text-app-fg-soft"
          style={{ fontFamily: "Manrope" }}
          numberOfLines={1}
        >
          {c.clientName || "—"}
          {c.oppositeParty ? `  vs  ${c.oppositeParty}` : ""}
        </Text>
      ) : null}

      {courtLine ? (
        <Text
          className="mt-1 text-[11px] text-app-fg-muted"
          style={{ fontFamily: "DMMono", letterSpacing: 0.3 }}
          numberOfLines={1}
        >
          {courtLine}
        </Text>
      ) : null}

      {c.cnr ? (
        <View className="mt-1.5">
          <CnrChip cnr={c.cnr} />
        </View>
      ) : null}

      {c.disposalRemarks ? (
        <Text
          className="mt-2 text-[12px] text-app-fg-soft"
          style={{ fontFamily: "Manrope" }}
          numberOfLines={2}
        >
          “{c.disposalRemarks}”
        </Text>
      ) : null}

      <DisposalSummary
        caStatus={c.caStatus || ""}
        receivedByClient={Boolean(c.receivedByClient)}
      />

      {onReopen || onDelete ? (
        <View className="mt-3 pt-3 border-t border-app-edge-soft flex-row items-center justify-between">
          <Text
            className="text-[10px] uppercase text-app-fg-muted"
            style={{ fontFamily: "DMMono", letterSpacing: 1 }}
          >
            {c.status}
          </Text>
          <View className="flex-row items-center" style={{ gap: 8 }}>
            {onDelete ? (
              <Pressable
                onPress={onDelete}
                disabled={reopening}
                hitSlop={6}
                className="flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5 active:opacity-80"
                style={{ backgroundColor: "#f6dccd" }}
                accessibilityRole="button"
                accessibilityLabel={`Delete ${c.caseNo} permanently`}
              >
                <Feather name="trash-2" size={12} color="#c14a37" />
                <Text
                  className="text-[11px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#c14a37" }}
                >
                  Delete
                </Text>
              </Pressable>
            ) : null}
            {onReopen ? (
              <Pressable
                onPress={onReopen}
                disabled={reopening}
                hitSlop={6}
                className="flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5 active:opacity-80"
                style={{ backgroundColor: "#efe5d0" }}
                accessibilityRole="button"
                accessibilityLabel={`Reopen ${c.caseNo}`}
              >
                {reopening ? (
                  <ActivityIndicator size="small" color="#8a5821" />
                ) : (
                  <Feather name="rotate-ccw" size={12} color="#8a5821" />
                )}
                <Text
                  className="text-[11px]"
                  style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
                >
                  Reopen
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
        </View>
      </View>
    </Pressable>
  );
}

function EmptyArchive({ searching }: { searching: boolean }) {
  return (
    <View className="items-center pt-12 px-6">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Feather name="archive" size={22} color="#8a5821" />
      </View>
      <Text
        className="mt-5 text-[22px] tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        {searching ? "Nothing matches." : "The archive is empty."}
      </Text>
      <Text
        className="mt-2 text-[13px] text-app-fg-muted text-center max-w-[300px]"
        style={{ fontFamily: "Manrope" }}
      >
        {searching
          ? "Try a different case number, client or court."
          : "When a matter is marked Disposed it moves here — out of the daily rolls, never out of reach."}
      </Text>
    </View>
  );
}
