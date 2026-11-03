import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Alert,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import Animated, { FadeInDown } from "react-native-reanimated";
import { FlashList } from "@shopify/flash-list";
import {
  CASE_SORT_OPTIONS,
  partnerListCases,
  partnerDeleteCase,
  partnerBulkDeleteCases,
  ApiError,
  type CaseListFilters,
  type PartnerCase,
} from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import ExportSheet from "../../../components/ExportSheet";
import ConfirmSheet from "../../../components/ConfirmSheet";
import CaseFilterSheet, {
  countActive,
  type CaseFilterLabels,
} from "../../../components/cases/CaseFilterSheet";
import CaseDetailView from "../../../components/cases/CaseDetailView";
import CnrChip from "../../../components/CnrChip";
import ImportCasesModal from "../../../components/cases/ImportCasesModal";
import { useBreakpoint } from "../../../lib/useBreakpoint";
import { formatDateForDisplay } from "../../../components/CaseFields";
import {
  CASE_EXPORT_COLUMNS,
  CASE_EXPORT_DEFAULT_KEYS,
  exportCases,
} from "../../../lib/exports";
import { FileOpError } from "../../../lib/files";
import { useDeleteRequestFallback } from "../../../components/useDeleteRequestFallback";

const PAGE_SIZE = 50;
// The server's own cap on one request (MAX_LIMIT in api/app/cases).
const MAX_LIMIT = 500;

export default function CaseVault() {
  const { offerDeleteRequest, deleteRequestSheet } =
    useDeleteRequestFallback();
  const router = useRouter();
  // Exports are office-admin only (server enforces role=admin; the
  // partner admin is the only mobile user that maps to it — /me doesn't
  // carry staff roles, so staff-admins export from the web).
  const { isPartnerAdmin } = useAuth();
  const [cases, setCases] = useState<PartnerCase[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Debounced copy of the search box — this is what actually hits the
  // server (the list, like the web vault, filters server-side).
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<CaseListFilters>({});
  const [filterLabels, setFilterLabels] = useState<CaseFilterLabels>({});
  const [filterOpen, setFilterOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Multi-select (office-admin only — bulk delete + export are admin-gated
  // server-side). `selectAllMatching` flips to "every matter matching the
  // current filters", spanning pages, for an export/delete of the whole set.
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAllMatching, setSelectAllMatching] = useState(false);
  // One sheet serves the single-row trash and the bulk delete.
  const [confirm, setConfirm] = useState<
    { kind: "row"; id: string; caseNo: string } | { kind: "bulk" } | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  // Tablet two-pane: ≥840dp the vault keeps the list on the left and
  // embeds the dossier on the right. Phones keep the pushed [id] route
  // (which stays registered either way, so deep links never break).
  const { isExpanded } = useBreakpoint();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pageRef = useRef(1);
  const reqIdRef = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 350);
    return () => clearTimeout(t);
  }, [query]);

  const params = useMemo<CaseListFilters>(
    () => ({ ...filters, search: search || undefined }),
    [filters, search]
  );

  const load = useCallback(
    async (mode: "reset" | "more" | "refresh") => {
      const myReq = ++reqIdRef.current;
      // "refresh" re-reads everything already on screen as one page.
      // Coming back from a matter used to call "reset", which collapsed
      // three hundred scrolled-through rows back to the first fifty —
      // so hunting for a case meant scrolling the same ground again
      // after every tap. Capped at the server's own ceiling.
      const depth = Math.min(pageRef.current * PAGE_SIZE, MAX_LIMIT);
      const page = mode === "more" ? pageRef.current + 1 : 1;
      const limit = mode === "refresh" ? depth : PAGE_SIZE;
      try {
        const data = await partnerListCases({
          filters: params,
          page,
          limit,
        });
        if (myReq !== reqIdRef.current) return; // params changed mid-flight
        // A refresh spans several pages in one request, so the cursor is
        // where those pages end, not the page number the server echoed.
        pageRef.current =
          mode === "refresh"
            ? Math.max(1, Math.ceil(data.cases.length / PAGE_SIZE))
            : data.page;
        setTotal(data.total);
        setHasMore(data.hasMore);
        setCases((prev) =>
          mode === "more" ? [...prev, ...data.cases] : data.cases
        );
        setError(null);
      } catch (err) {
        if (myReq !== reqIdRef.current) return;
        setError(err instanceof Error ? err.message : "Failed to load");
      }
    },
    [params]
  );

  // Boot + every search/filter change.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    load("reset").finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  // Silent refresh when returning to the tab (a hearing may have been
  // updated from a detail screen).
  useFocusEffect(
    useCallback(() => {
      load("refresh");
    }, [load])
  );

  // Leaving the vault clears what you were looking for.
  //
  // Chambers asked for this: search "raj", open a matter, come back, and
  // the box still held "raj" — so the roll looked three matters long and
  // it took a moment to spot the ✕ that explained why. A filter set
  // before a detour is a filter you've stopped thinking about. Refetching
  // on focus, above, is a different concern: that one is freshness, this
  // one is starting clean.
  //
  // Deliberately its own effect with stable deps. Folding it into the
  // cleanup of the refetch above would re-run — and so wipe the box — on
  // every keystroke, because that callback changes with `load`.
  //
  // Each setter no-ops when there's nothing to clear, so the common case
  // (leaving an unfiltered vault) doesn't change state and doesn't spend
  // a request re-fetching a list that never narrowed.
  useFocusEffect(
    useCallback(
      () => () => {
        setQuery((prev) => (prev ? "" : prev));
        setSearch((prev) => (prev ? "" : prev));
        // Order survives: it's a preference, not something you set for
        // one lookup and forget.
        setFilters((prev) =>
          Object.keys(prev).some((k) => k !== "sort")
            ? (prev.sort ? { sort: prev.sort } : {})
            : prev
        );
        setFilterLabels((prev) => (Object.keys(prev).length ? {} : prev));
        setSelectionMode((prev) => (prev ? false : prev));
      },
      []
    )
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load("refresh");
    setRefreshing(false);
  }, [load]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loading || loadingMore || refreshing) return;
    setLoadingMore(true);
    await load("more");
    setLoadingMore(false);
  }, [hasMore, loading, loadingMore, refreshing, load]);

  const activeFilterCount = countActive(filters);

  const clearFilter = (key: keyof CaseListFilters) => {
    setFilters((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Date-range chip collapses both bounds into one label.
  const filterChips = useMemo(() => {
    const chips: { key: string; label: string; clear: () => void }[] = [];
    if (filters.sort && filters.sort !== "recent") {
      const label =
        CASE_SORT_OPTIONS.find((o) => o.key === filters.sort)?.label ??
        "Order";
      chips.push({
        key: "sort",
        label,
        clear: () => clearFilter("sort"),
      });
    }
    if (filters.courtPlace) {
      chips.push({
        key: "courtPlace",
        label: filters.courtPlace,
        clear: () => clearFilter("courtPlace"),
      });
    }
    if (filters.courtId) {
      chips.push({
        key: "courtId",
        label: filterLabels.courtId ?? "Court",
        clear: () => clearFilter("courtId"),
      });
    }
    if (filters.advocateId) {
      chips.push({
        key: "advocateId",
        label: filterLabels.advocateId ?? "Filed by",
        clear: () => clearFilter("advocateId"),
      });
    }
    if (filters.fromDate || filters.toDate) {
      const from = filters.fromDate
        ? formatDateForDisplay(filters.fromDate)
        : "…";
      const to = filters.toDate ? formatDateForDisplay(filters.toDate) : "…";
      chips.push({
        key: "dates",
        label: `${from} → ${to}`,
        clear: () => {
          setFilters((prev) => {
            const next = { ...prev };
            delete next.fromDate;
            delete next.toDate;
            return next;
          });
        },
      });
    }
    return chips;
  }, [filters, filterLabels]);

  // ── Selection ──
  const selectionCount = selectAllMatching ? total : selectedIds.size;
  const allLoadedSelected =
    cases.length > 0 &&
    (selectAllMatching || cases.every((c) => selectedIds.has(c.id)));
  const moreThanLoaded = total > cases.length;
  const isSelected = useCallback(
    (id: string) => selectAllMatching || selectedIds.has(id),
    [selectAllMatching, selectedIds]
  );

  // A changed filter/search means a different result set — drop any prior
  // selection so a stale id can't ride into a bulk action.
  useEffect(() => {
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, [params]);

  const enterSelection = useCallback((initialId?: string) => {
    setSelectionMode(true);
    setSelectAllMatching(false);
    setSelectedIds(initialId ? new Set([initialId]) : new Set());
  }, []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedIds(new Set());
    setSelectAllMatching(false);
  }, []);

  const toggleSelect = useCallback(
    (id: string) => {
      if (selectAllMatching) {
        // Stepping out of "all matching" — fall back to the loaded page
        // minus the row just unticked.
        setSelectAllMatching(false);
        setSelectedIds(new Set(cases.map((c) => c.id).filter((x) => x !== id)));
        return;
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [selectAllMatching, cases]
  );

  const toggleSelectAllLoaded = useCallback(() => {
    setSelectAllMatching(false);
    setSelectedIds(allLoadedSelected ? new Set() : new Set(cases.map((c) => c.id)));
  }, [allLoadedSelected, cases]);

  // ── Deletes (single + bulk) ──
  const runDelete = useCallback(async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      if (confirm.kind === "row") {
        await partnerDeleteCase(confirm.id);
        setCases((prev) => prev.filter((c) => c.id !== confirm.id));
        setTotal((t) => Math.max(0, t - 1));
      } else {
        await partnerBulkDeleteCases(
          selectAllMatching
            ? { all: true, filters: params }
            : { ids: [...selectedIds] }
        );
        exitSelection();
        await load("refresh");
      }
      setConfirm(null);
    } catch (err) {
      setConfirm(null);
      if (offerDeleteRequest(err)) return;
      Alert.alert(
        "Couldn't delete",
        err instanceof ApiError ? err.message : "Try again."
      );
    } finally {
      setConfirmBusy(false);
    }
  }, [confirm, selectAllMatching, params, selectedIds, exitSelection, load]);

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        {selectionMode ? (
          <SelectionTopBar
            count={selectionCount}
            onCancel={exitSelection}
            allLoadedSelected={allLoadedSelected}
            onToggleSelectAll={toggleSelectAllLoaded}
          />
        ) : (
          <TopBar
            count={total}
            // Everyone in chambers can download the rolls. Selecting rows
            // stays the admin's, since the same mode offers bulk delete.
            onExport={() => setExporting(true)}
            onImport={() => setImportOpen(true)}
            onSelect={isPartnerAdmin ? () => enterSelection() : null}
          />
        )}

        <View className="flex-1 flex-row">
        {/* Left pane: search + rolls (the whole screen on phones) */}
        <View
          style={
            isExpanded
              ? {
                  width: 392,
                  borderRightWidth: 1,
                  borderRightColor: "#e3d9c0",
                }
              : { flex: 1 }
          }
        >
        {/* Search bar — sticky under topbar */}
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
              placeholder="Search file no., case no., CNR, party..."
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
            <Pressable
              onPress={() => setFilterOpen(true)}
              hitSlop={8}
              className="active:opacity-60 flex-row items-center gap-1 pl-2"
              style={{
                borderLeftWidth: 1,
                borderLeftColor: "#efe5d0",
              }}
              accessibilityRole="button"
              accessibilityLabel="Filter cases"
            >
              <Feather
                name="sliders"
                size={15}
                color={activeFilterCount > 0 ? "#8a5821" : "#a89c80"}
              />
              {activeFilterCount > 0 ? (
                <View
                  className="items-center justify-center rounded-full"
                  style={{
                    minWidth: 15,
                    height: 15,
                    backgroundColor: "#c5853a",
                    paddingHorizontal: 3,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "DMMono-Medium",
                      fontSize: 9,
                      color: "#2a1c08",
                    }}
                  >
                    {activeFilterCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {/* Active filter chips */}
          {filterChips.length > 0 ? (
            <View className="flex-row flex-wrap mt-2" style={{ gap: 6 }}>
              {filterChips.map((chip) => (
                <Pressable
                  key={chip.key}
                  onPress={chip.clear}
                  className="flex-row items-center gap-1.5 rounded-full px-2.5 active:opacity-70"
                  style={{
                    paddingVertical: 4,
                    backgroundColor: "#efe5d0",
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear filter ${chip.label}`}
                >
                  <Text
                    className="text-[11px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#4d4538" }}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </Text>
                  <Feather name="x" size={11} color="#8a5821" />
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          // FlashList recycles rows, so the entrance stagger lives on the
          // list container — per-row `entering` would replay on recycle.
          <Animated.View
            entering={FadeInDown.duration(380)}
            className="flex-1"
          >
            <FlashList
              data={cases}
              extraData={
                selectionMode
                  ? `${selectAllMatching ? "ALL" : [...selectedIds].join(",")}|sel`
                  : `${selectedId ?? ""}|view`
              }
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <CaseCard
                  c={item}
                  selectionMode={selectionMode}
                  selected={
                    selectionMode
                      ? isSelected(item.id)
                      : isExpanded && selectedId === item.id
                  }
                  onPress={() => {
                    if (selectionMode) {
                      toggleSelect(item.id);
                    } else if (isExpanded) {
                      setSelectedId(item.id);
                    } else {
                      router.push(`/(home)/cases/${item.id}` as never);
                    }
                  }}
                  onLongPress={
                    isPartnerAdmin && !selectionMode
                      ? () => enterSelection(item.id)
                      : undefined
                  }
                  onToggleSelect={() => toggleSelect(item.id)}
                  onEdit={() =>
                    router.push(`/(home)/cases/edit/${item.id}` as never)
                  }
                  onDelete={() =>
                    setConfirm({
                      kind: "row",
                      id: item.id,
                      caseNo: item.caseNo,
                    })
                  }
                />
              )}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onEndReached={loadMore}
              onEndReachedThreshold={0.4}
              contentContainerStyle={{
                paddingHorizontal: 20,
                paddingTop: 12,
                paddingBottom: 24,
              }}
              ItemSeparatorComponent={RowGap}
              ListHeaderComponent={
                error ? (
                  <View className="rounded-md border border-app-danger/30 bg-app-danger-soft px-4 py-3 mb-4">
                    <Text
                      className="text-[13px] text-app-fg"
                      style={{ fontFamily: "Manrope" }}
                    >
                      {error}
                    </Text>
                  </View>
                ) : null
              }
              ListFooterComponent={
                loadingMore ? (
                  <View className="items-center py-5">
                    <ActivityIndicator color="#c5853a" size="small" />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                search || activeFilterCount > 0 ? (
                  <NoMatches
                    query={search || "filters"}
                    onClear={() => {
                      setQuery("");
                      setFilters({});
                    }}
                  />
                ) : (
                  <EmptyVault
                    onAdd={() => router.push("/(home)/cases/new")}
                  />
                )
              }
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
        {selectionMode ? (
          <SelectionActionBar
            count={selectionCount}
            total={total}
            selectAllMatching={selectAllMatching}
            moreThanLoaded={moreThanLoaded}
            onSelectAllMatching={() => setSelectAllMatching(true)}
            onExport={() => setExporting(true)}
            onDelete={() => setConfirm({ kind: "bulk" })}
          />
        ) : null}
        </View>

        {/* Right pane: the dossier (tablets only) */}
        {isExpanded ? (
          <View className="flex-1">
            {selectedId ? (
              <CaseDetailView
                key={selectedId}
                caseId={selectedId}
                onDeleted={() => {
                  setSelectedId(null);
                  load("reset");
                }}
              />
            ) : (
              <View className="flex-1 items-center justify-center px-10">
                <View
                  className="h-14 w-14 items-center justify-center rounded-full"
                  style={{ backgroundColor: "#efe5d0" }}
                >
                  <Feather name="book-open" size={22} color="#8a5821" />
                </View>
                <Text
                  className="mt-5 text-[20px] tracking-tight text-app-ink text-center"
                  style={{ fontFamily: "Crimson-SemiBold" }}
                >
                  Pick a matter from the rolls.
                </Text>
                <Text
                  className="mt-2 text-[13px] text-app-fg-muted text-center max-w-[300px]"
                  style={{ fontFamily: "Manrope" }}
                >
                  Its full dossier — dates, documents, contacts — opens
                  right here.
                </Text>
              </View>
            )}
          </View>
        ) : null}
        </View>
      </SafeAreaView>

      <ExportSheet
        visible={exporting}
        onClose={() => setExporting(false)}
        eyebrow="Case Vault"
        title="Export the case rolls"
        contextLine={
          selectionMode && selectionCount > 0
            ? `${selectionCount} selected ${
                selectionCount === 1 ? "matter" : "matters"
              }`
            : activeFilterCount > 0 || search
              ? `Current view · ${total} matters (filters carry into the file)`
              : `All active matters · ${total}`
        }
        columns={{
          // "Disposed On" is always empty on the active vault; the
          // disposed archive export offers it instead.
          catalog: CASE_EXPORT_COLUMNS.filter((c) => c.key !== "disposedAt"),
          defaultKeys: CASE_EXPORT_DEFAULT_KEYS,
        }}
        run={async (format, columnKeys) => {
          try {
            return await exportCases(format, {
              filters: params,
              columns: columnKeys,
              // A concrete tick-list exports exactly those rows; "select all
              // matching" falls back to the filter query (the whole set).
              selectedIds:
                selectionMode && !selectAllMatching && selectedIds.size > 0
                  ? [...selectedIds]
                  : undefined,
            });
          } catch (err) {
            // Until the server opens exports to the whole office it still
            // refuses everyone but the admin — say that plainly rather
            // than show a bare "Forbidden".
            if (
              !isPartnerAdmin &&
              err instanceof FileOpError &&
              err.status === 403
            ) {
              throw new Error(
                "Downloading is still limited to the office admin. Ask them to download it for now."
              );
            }
            throw err;
          }
        }}
      />

      <CaseFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filters}
        onApply={(next, labels) => {
          setFilters(next);
          setFilterLabels(labels);
        }}
      />

      <ImportCasesModal
        visible={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => load("reset")}
      />

      <ConfirmSheet
        visible={confirm !== null}
        onClose={() => setConfirm(null)}
        onConfirm={runDelete}
        busy={confirmBusy}
        title={
          confirm?.kind === "bulk"
            ? `Delete ${selectionCount} ${
                selectionCount === 1 ? "matter" : "matters"
              }?`
            : "Delete this matter?"
        }
        message={
          confirm?.kind === "bulk"
            ? `The ${selectionCount} selected ${
                selectionCount === 1 ? "matter leaves" : "matters leave"
              } the database for good, freeing ${
                selectionCount === 1 ? "its CNR" : "their CNRs"
              } for re-use. This can't be undone.`
            : `${
                confirm?.caseNo ?? "This matter"
              } leaves the database for good, freeing its CNR for re-use. This can't be undone — to keep a finished matter on record, set its status to Disposed instead.`
        }
        confirmLabel={
          confirm?.kind === "bulk" ? `Delete ${selectionCount}` : "Delete"
        }
      />

      {deleteRequestSheet}
    </View>
  );
}

function RowGap() {
  return <View style={{ height: 12 }} />;
}

function TopBar({
  count,
  onExport,
  onImport,
  onSelect,
}: {
  count: number;
  onExport?: (() => void) | null;
  onImport?: (() => void) | null;
  onSelect?: (() => void) | null;
}) {
  const router = useRouter();
  return (
    <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center">
      {/* Title shrinks first so the action buttons never get clipped on
          narrow phones (Disposed lives in the More tab now). */}
      <View className="flex-1 min-w-0 pr-2">
        <Text
          className="text-[10px] uppercase text-app-copper-deep"
          style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
        >
          The Vault
        </Text>
        <View className="flex-row items-baseline gap-2 mt-0.5">
          <Text
            className="text-[18px] font-semibold tracking-tight text-app-ink leading-none"
            style={{ fontFamily: "Crimson-SemiBold" }}
            numberOfLines={1}
          >
            Case Vault
          </Text>
          {count > 0 ? (
            <Text
              className="text-[11px] text-app-fg-muted tabular-nums"
              style={{ fontFamily: "DMMono", letterSpacing: 0.5 }}
            >
              · {count}
            </Text>
          ) : null}
        </View>
      </View>
      <View className="flex-row items-center" style={{ gap: 8 }}>
        {onImport ? (
          <Pressable
            onPress={onImport}
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
            accessibilityLabel="Import cases from CSV"
          >
            <Feather name="upload" size={15} color="#8a5821" />
          </Pressable>
        ) : null}
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
            accessibilityLabel="Export case rolls"
          >
            <Feather name="download" size={15} color="#8a5821" />
          </Pressable>
        ) : null}
        {onSelect ? (
          <Pressable
            onPress={onSelect}
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
            accessibilityLabel="Select matters for bulk actions"
          >
            <Feather name="check-square" size={15} color="#8a5821" />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => router.push("/(home)/cases/new")}
          className="rounded-md flex-row items-center gap-1.5 px-3 py-2 active:opacity-90"
          style={{
            backgroundColor: "#c5853a",
            shadowColor: "#c5853a",
            shadowOpacity: 0.3,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}
        >
          <Feather name="plus" size={14} color="#2a1c08" />
          <Text
            className="text-[12px] font-semibold"
            style={{ fontFamily: "Manrope-SemiBold", color: "#2a1c08" }}
          >
            New
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SelectionTopBar({
  count,
  onCancel,
  allLoadedSelected,
  onToggleSelectAll,
}: {
  count: number;
  onCancel: () => void;
  allLoadedSelected: boolean;
  onToggleSelectAll: () => void;
}) {
  return (
    <View
      className="border-b border-app-edge px-4 py-3.5 flex-row items-center"
      style={{ gap: 12, backgroundColor: "#fbf6ea" }}
    >
      <Pressable
        onPress={onCancel}
        hitSlop={10}
        className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
        style={{ backgroundColor: "#ffffff" }}
        accessibilityLabel="Cancel selection"
      >
        <Feather name="x" size={17} color="#0a1124" />
      </Pressable>
      <Text
        className="flex-1 text-[15px] text-app-ink"
        style={{ fontFamily: "Manrope-SemiBold" }}
      >
        {count > 0 ? `${count} selected` : "Select matters"}
      </Text>
      <Pressable
        onPress={onToggleSelectAll}
        hitSlop={8}
        className="flex-row items-center gap-1.5 rounded-md px-2.5 py-1.5 active:opacity-70"
        style={{ backgroundColor: "#efe5d0" }}
        accessibilityRole="button"
        accessibilityLabel={
          allLoadedSelected ? "Clear selection" : "Select all on this page"
        }
      >
        <Feather
          name={allLoadedSelected ? "square" : "check-square"}
          size={13}
          color="#8a5821"
        />
        <Text
          className="text-[11px]"
          style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
        >
          {allLoadedSelected ? "Clear" : "Page"}
        </Text>
      </Pressable>
    </View>
  );
}

function SelectionActionBar({
  count,
  total,
  selectAllMatching,
  moreThanLoaded,
  onSelectAllMatching,
  onExport,
  onDelete,
}: {
  count: number;
  total: number;
  selectAllMatching: boolean;
  moreThanLoaded: boolean;
  onSelectAllMatching: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const disabled = count === 0;
  return (
    <View
      className="border-t border-app-edge bg-app-paper px-4 pt-3 pb-3"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -3 },
        elevation: 8,
      }}
    >
      {count > 0 && !selectAllMatching && moreThanLoaded ? (
        <Pressable
          onPress={onSelectAllMatching}
          className="mb-2.5 self-start active:opacity-60"
          hitSlop={6}
        >
          <Text
            className="text-[12px]"
            style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
          >
            Select all {total} matters
          </Text>
        </Pressable>
      ) : selectAllMatching ? (
        <Text
          className="mb-2.5 text-[12px] text-app-fg-muted"
          style={{ fontFamily: "Manrope" }}
        >
          All {total} matching {total === 1 ? "matter" : "matters"} selected
        </Text>
      ) : null}
      <View className="flex-row gap-3">
        <Pressable
          onPress={onExport}
          disabled={disabled}
          className="flex-1 rounded-md py-3 items-center justify-center flex-row gap-2 active:opacity-80"
          style={{
            backgroundColor: "#ffffff",
            borderWidth: 1,
            borderColor: "#e3d9c0",
            opacity: disabled ? 0.5 : 1,
          }}
        >
          <Feather name="download" size={14} color="#8a5821" />
          <Text
            className="text-[13px]"
            style={{ fontFamily: "Manrope-SemiBold", color: "#8a5821" }}
          >
            Export{count > 0 ? ` (${count})` : ""}
          </Text>
        </Pressable>
        <Pressable
          onPress={onDelete}
          disabled={disabled}
          className="flex-1 rounded-md py-3 items-center justify-center flex-row gap-2 active:opacity-80"
          style={{ backgroundColor: "#c14a37", opacity: disabled ? 0.5 : 1 }}
        >
          <Feather name="trash-2" size={14} color="#ffffff" />
          <Text
            className="text-[13px]"
            style={{ fontFamily: "Manrope-SemiBold", color: "#ffffff" }}
          >
            Delete{count > 0 ? ` (${count})` : ""}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function SelectCheckbox({
  checked,
  onPress,
}: {
  checked: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      className="h-7 w-7 items-center justify-center rounded-full"
      style={{
        backgroundColor: checked ? "#c5853a" : "transparent",
        borderWidth: checked ? 0 : 1.5,
        borderColor: "#c5b99e",
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
    >
      {checked ? <Feather name="check" size={15} color="#2a1c08" /> : null}
    </Pressable>
  );
}

function CaseCard({
  c,
  onPress,
  onLongPress,
  onEdit,
  onDelete,
  onToggleSelect,
  selected,
  selectionMode,
}: {
  c: PartnerCase;
  onPress: () => void;
  onLongPress?: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleSelect?: () => void;
  selected?: boolean;
  selectionMode?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const next = c.nextHearingDate ? new Date(c.nextHearingDate) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isToday = next && next.toDateString() === new Date().toDateString();
  const isOverdue = next && next < today;
  const isPending = !next;

  const dateBadge =
    isOverdue || isPending
      ? { bg: "#f6dccd", fg: "#c14a37" }
      : isToday
        ? { bg: "rgba(197,133,58,0.18)", fg: "#8a5821" }
        : { bg: "#d2e6e7", fg: "#56a0a8" };

  const courtLine = [c.courtName, c.courtPlace].filter(Boolean).join(", ");

  return (
    <>
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      className="rounded-xl bg-app-paper p-4 active:opacity-90"
      style={{
        shadowColor: "#0a1124",
        shadowOpacity: 0.05,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 1 },
        elevation: 1,
        borderLeftWidth: 3,
        borderLeftColor: "#c5853a",
        borderWidth: selected ? 1.5 : 0,
        borderColor: selected ? "#c5853a" : "transparent",
      }}
    >
      {/* Top row — case no, file no, status pill */}
      <View className="flex-row items-baseline gap-2 flex-wrap">
        <Text
          className="text-[18px] font-semibold tracking-tight text-app-ink"
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
        {c.status ? (
          <View
            className="rounded-md px-1.5 py-0.5 ml-auto"
            style={{ borderWidth: 1, borderColor: "#8a5821" }}
          >
            <Text
              className="text-[9px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.2,
                color: "#0a1124",
              }}
            >
              {c.status}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Parties */}
      {(c.clientName || c.oppositeParty) ? (
        <Text
          className="mt-2 text-[13px] text-app-fg-soft"
          style={{ fontFamily: "Manrope" }}
        >
          <Text style={{ color: "#8a5821" }}>Client </Text>
          {c.clientName ? (
            <Text
              style={{
                fontFamily: "Manrope-SemiBold",
                color: "#0a1124",
              }}
            >
              {c.clientName}
            </Text>
          ) : (
            <Text style={{ color: "#a89c80" }}>—</Text>
          )}
          {c.oppositeParty ? (
            <>
              <Text style={{ color: "#8a5821" }}>{"  vs  "}</Text>
              <Text
                style={{
                  fontFamily: "Manrope-SemiBold",
                  color: "#0a1124",
                }}
              >
                {c.oppositeParty}
              </Text>
            </>
          ) : null}
        </Text>
      ) : null}

      {/* Court */}
      {courtLine ? (
        <Text
          className="mt-1 text-[11px] text-app-fg-muted"
          style={{ fontFamily: "DMMono", letterSpacing: 0.3 }}
        >
          {courtLine}
        </Text>
      ) : null}
      {/* CNR — tap to copy + open eCourts */}
      {c.cnr ? (
        <View className="mt-1.5">
          <CnrChip cnr={c.cnr} />
        </View>
      ) : null}

      {/* Footer — next date + chevron */}
      <View className="mt-3 pt-3 border-t border-app-edge-soft flex-row items-center justify-between">
        {next ? (
          <View
            className="rounded-md px-2 py-0.5"
            style={{ backgroundColor: dateBadge.bg }}
          >
            <Text
              className="text-[11px] font-semibold tabular-nums"
              style={{
                fontFamily: "DMMono-Medium",
                color: dateBadge.fg,
                letterSpacing: 0.5,
              }}
            >
              {next.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
              {isToday ? " · TODAY" : isOverdue ? " · OVERDUE" : ""}
            </Text>
          </View>
        ) : (
          <View
            className="rounded-md px-2 py-0.5"
            style={{ backgroundColor: dateBadge.bg }}
          >
            <Text
              className="text-[10px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.2,
                color: dateBadge.fg,
              }}
            >
              Pending date
            </Text>
          </View>
        )}
        {selectionMode ? (
          <SelectCheckbox checked={!!selected} onPress={onToggleSelect} />
        ) : (
          <Pressable
            onPress={() => setMenuOpen(true)}
            hitSlop={10}
            className="h-7 w-7 items-center justify-center rounded-md active:opacity-50"
            style={{ backgroundColor: "#efe5d0" }}
            accessibilityLabel="Case actions"
          >
            <Feather name="more-horizontal" size={16} color="#8a5821" />
          </Pressable>
        )}
      </View>
    </Pressable>

      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          onPress={() => setMenuOpen(false)}
          className="flex-1"
          style={{ backgroundColor: "rgba(10,17,36,0.55)" }}
        >
          <View
            className="mt-auto rounded-t-3xl bg-app-paper px-5 pt-3 pb-8"
            style={{
              shadowColor: "#0a1124",
              shadowOpacity: 0.2,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: -6 },
              elevation: 12,
            }}
            onStartShouldSetResponder={() => true}
          >
            <View
              className="self-center mb-3 h-1.5 w-12 rounded-full"
              style={{ backgroundColor: "#e3d9c0" }}
            />
            <Text
              className="text-[10px] uppercase text-app-copper-deep mb-1"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
              numberOfLines={1}
            >
              {c.caseNo}
            </Text>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                onEdit();
              }}
              className="flex-row items-center gap-3 py-3.5 active:opacity-50"
              style={{ borderBottomWidth: 1, borderBottomColor: "#efe5d0" }}
            >
              <Feather name="edit-3" size={17} color="#0a1124" />
              <Text
                style={{
                  fontFamily: "Manrope-SemiBold",
                  fontSize: 15,
                  color: "#0a1124",
                }}
              >
                Edit matter
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false);
                onDelete();
              }}
              className="flex-row items-center gap-3 py-3.5 active:opacity-50"
            >
              <Feather name="trash-2" size={17} color="#c14a37" />
              <Text
                style={{
                  fontFamily: "Manrope-SemiBold",
                  fontSize: 15,
                  color: "#c14a37",
                }}
              >
                Delete matter
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function NoMatches({
  query,
  onClear,
}: {
  query: string;
  onClear: () => void;
}) {
  return (
    <View
      className="mt-6 rounded-xl px-5 py-10 items-center"
      style={{
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#e3d9c0",
        borderStyle: "dashed",
      }}
    >
      <Feather name="search" size={20} color="#a89c80" />
      <Text
        className="mt-3 text-[13px] text-app-fg-muted text-center"
        style={{ fontFamily: "Manrope" }}
      >
        No matches for{" "}
        <Text
          style={{
            fontFamily: "Manrope-SemiBold",
            color: "#0a1124",
          }}
        >
          “{query}”
        </Text>
      </Text>
      <Pressable
        onPress={onClear}
        className="mt-3 rounded-md px-3 py-1.5 active:opacity-50"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Text
          className="text-[11px] uppercase"
          style={{
            fontFamily: "DMMono-Medium",
            letterSpacing: 1.5,
            color: "#8a5821",
          }}
        >
          Clear search
        </Text>
      </Pressable>
    </View>
  );
}

function EmptyVault({ onAdd }: { onAdd: () => void }) {
  return (
    <View className="items-center pt-12">
      <View
        className="h-14 w-14 items-center justify-center rounded-full"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Feather name="briefcase" size={22} color="#8a5821" />
      </View>
      <Text
        className="mt-5 text-[24px] font-semibold tracking-tight text-app-ink text-center"
        style={{ fontFamily: "Crimson-SemiBold" }}
      >
        The vault is empty.
      </Text>
      <Text
        className="mt-2 text-[13px] text-app-fg-muted text-center max-w-[300px]"
        style={{ fontFamily: "Manrope" }}
      >
        Add your first matter — case number, court, client, status, next
        hearing date. The dashboard, hearings, and pending list all read from
        this one place.
      </Text>
      <Pressable
        onPress={onAdd}
        className="mt-6 rounded-md flex-row items-center gap-2 px-6 py-3 active:opacity-90"
        style={{
          backgroundColor: "#0a1124",
          shadowColor: "#0a1124",
          shadowOpacity: 0.2,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        }}
      >
        <Feather name="plus" size={14} color="#f5ebd6" />
        <Text
          className="text-[13px] font-semibold text-app-ivory"
          style={{ fontFamily: "Manrope-SemiBold" }}
        >
          Add the first case
        </Text>
      </Pressable>
    </View>
  );
}
