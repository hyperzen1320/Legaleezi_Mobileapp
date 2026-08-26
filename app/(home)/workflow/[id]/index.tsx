import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Alert,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";

import {
  partnerGetBoardFull,
  partnerCreateList,
  partnerCreateTask,
  partnerMoveTask,
  partnerDeleteTask,
  partnerReorderLists,
  partnerDeleteRequestCount,
  deleteRequestRequired,
  ApiError,
  type BoardFullResponse,
  type CanvasList,
  type CanvasEdge,
  type PreviewTask,
  type DeleteRequestRequiredError,
} from "../../../../lib/api";
import { BOARD_COLOR_STYLES } from "../../../../components/BoardColors";
import { useBoardLiveFeed } from "../../../../lib/useBoardLiveFeed";
import { useBoardPresence } from "../../../../lib/useBoardPresence";
import { useAuth } from "../../../../lib/auth-context";

import CardItem from "../../../../components/workflow/CardItem";
import AddCardComposer from "../../../../components/workflow/AddCardComposer";
import AddListComposer from "../../../../components/workflow/AddListComposer";
import EdgePill from "../../../../components/workflow/EdgePill";
import CardActionsSheet from "../../../../components/workflow/CardActionsSheet";
import RequestDeleteSheet from "../../../../components/workflow/RequestDeleteSheet";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import {
  useBoardDnd,
  DropIndicator,
} from "../../../../components/workflow/dnd/useBoardDnd";
import { useListDnd } from "../../../../components/workflow/dnd/useListDnd";
import { useBreakpoint } from "../../../../lib/useBreakpoint";
import BoardExportSheet from "../../../../components/workflow/BoardExportSheet";
import BoardSettingsSheet from "../../../../components/workflow/BoardSettingsSheet";
import BoardSnapshotView from "../../../../components/workflow/BoardSnapshotView";
import { exportBoardXlsx } from "../../../../lib/exports";
import {
  captureBoardPng,
  boardPngToPdf,
} from "../../../../lib/boardSnapshot";
import { File } from "expo-file-system";
import type { DownloadedFile } from "../../../../lib/files";

const TEMP_PREFIX = "tmp:";

// Vertical breathing room inside the horizontal board scroller. Shared
// between the scroller's contentContainerStyle and the column height cap
// so the two can never drift apart.
const BOARD_V_PADDING = 14;

function tempId(): string {
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function isTemp(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

export default function BoardDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const boardId = String(id);
  const router = useRouter();
  // The bell opens the board's audit trail and the delete-request queue —
  // both the office admin's. It used to be on the header for everyone,
  // which is how juniors could read the activity feed.
  const { isPartnerAdmin } = useAuth();

  // Compact keeps a peek of the next column (the "there's more" cue);
  // bigger windows get fixed, comfortable column widths and free scroll.
  const { bp, width: windowWidth, isExpanded } = useBreakpoint();
  const listWidth =
    bp === "compact"
      ? Math.min(300, Math.round(windowWidth * 0.78))
      : bp === "medium"
        ? 320
        : 340;

  // Measured height of the board scroller. Columns are capped to it so a
  // long list scrolls INSIDE its column instead of running off the bottom
  // of a horizontal-only scroller, where nothing can reach it. It starts
  // null and the columns fall back to a conservative estimate for the one
  // frame before layout lands.
  const [boardViewportH, setBoardViewportH] = useState<number | null>(null);

  const [data, setData] = useState<BoardFullResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // PNG/PDF snapshot: mount the full-content capture view (occluded by
  // an opaque scrim), wait one laid-out frame, photograph it.
  const [snapshotting, setSnapshotting] = useState(false);
  const snapshotInnerRef = useRef<View | null>(null);
  const snapshotReadyRef = useRef<
    ((s: { w: number; h: number }) => void) | null
  >(null);

  const capture = useCallback(
    async (format: "png" | "pdf"): Promise<DownloadedFile> => {
      if (!data) throw new Error("Board not loaded yet.");
      setSnapshotting(true);
      try {
        const size = await new Promise<{ w: number; h: number }>(
          (resolve, reject) => {
            snapshotReadyRef.current = resolve;
            setTimeout(
              () => reject(new Error("Snapshot timed out — try again.")),
              8000
            );
          }
        );
        const png = await captureBoardPng(snapshotInnerRef, size.w, size.h);
        const slug =
          data.board.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "") || "board";
        const d = new Date();
        const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
        if (format === "png") {
          return {
            uri: png.uri,
            filename: `${slug}-${stamp}.png`,
            mime: "image/png",
            size: new File(png.uri).size,
          };
        }
        const pdfUri = await boardPngToPdf(png, data.board.title);
        return {
          uri: pdfUri,
          filename: `${slug}-${stamp}.pdf`,
          mime: "application/pdf",
          size: new File(pdfUri).size,
        };
      } finally {
        snapshotReadyRef.current = null;
        setSnapshotting(false);
      }
    },
    [data]
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);

  // Which column has its "add a card" input open, if any — its drag
  // gesture stands down while someone is typing in it.
  const [composingListId, setComposingListId] = useState<string | null>(null);

  // Long-press card sheet + smart-delete sheet state
  const [activeCard, setActiveCard] = useState<PreviewTask | null>(null);
  const [requestTarget, setRequestTarget] =
    useState<DeleteRequestRequiredError | null>(null);

  const live = useBoardLiveFeed({ boardId });
  const presence = useBoardPresence(boardId);

  /* ─── Load + refresh ─── */
  const load = useCallback(async () => {
    try {
      const res = await partnerGetBoardFull(boardId);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load board");
    }
  }, [boardId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      await load();
      if (alive) setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, [load]);

  // Refresh on focus (returning from card detail / drawer)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Live-feed reconcile: on any cross-user list/task event, refetch.
  // Debounced via the ref so a burst doesn't spam refetches.
  const lastFeedIndex = useRef(0);
  const resyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const start = lastFeedIndex.current;
    if (start >= live.newRows.length) return;
    const fresh = live.newRows.slice(start);
    lastFeedIndex.current = live.newRows.length;
    const myId = data?.currentUserId;

    let needsResync = false;
    for (const row of fresh) {
      if (myId && row.actorUserId === myId) continue;
      if (
        row.action.startsWith("task.") ||
        row.action.startsWith("list.") ||
        row.action.startsWith("board.") ||
        row.action === "delete_request.approved"
      ) {
        needsResync = true;
        break;
      }
    }
    if (!needsResync) return;
    if (resyncTimer.current) return;
    const fire = () => {
      // Mid-drag, defer — a refetch re-renders the columns under the
      // finger. Re-arm until the drop lands.
      if (isDraggingRef.current) {
        resyncTimer.current = setTimeout(fire, 800);
        return;
      }
      resyncTimer.current = null;
      load();
    };
    resyncTimer.current = setTimeout(fire, 800);
  }, [live.newRows, data?.currentUserId, load]);

  // Pending delete-requests badge (admin only effectively)
  useEffect(() => {
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await partnerDeleteRequestCount({ boardId });
        if (alive) setPendingCount(res.count || 0);
      } catch {
        /* ignore */
      }
    };
    fetchCount();
    const t = setInterval(fetchCount, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [boardId]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /* ─── Derived: tasks grouped by list, edges keyed by list ─── */
  const tasksByList = useMemo(() => {
    const map = new Map<string, PreviewTask[]>();
    if (!data) return map;
    for (const list of data.lists) map.set(list.id, []);
    for (const t of data.tasks) {
      const arr = map.get(t.listId);
      if (arr) arr.push(t);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return map;
  }, [data]);

  const edgesByList = useMemo(() => {
    const map = new Map<
      string,
      { incoming: CanvasEdge[]; outgoing: CanvasEdge[] }
    >();
    if (!data) return map;
    for (const list of data.lists) {
      map.set(list.id, { incoming: [], outgoing: [] });
    }
    for (const e of data.edges) {
      map.get(e.targetListId)?.incoming.push(e);
      map.get(e.sourceListId)?.outgoing.push(e);
    }
    return map;
  }, [data]);

  const listTitleById = useMemo(() => {
    const m = new Map<string, string>();
    if (!data) return m;
    for (const l of data.lists) m.set(l.id, l.title);
    return m;
  }, [data]);

  const sortedLists = useMemo(
    () => (data ? data.lists.slice().sort((a, b) => a.sortOrder - b.sortOrder) : []),
    [data]
  );

  /* ─── Drag & drop ─── */

  // Precise optimistic move (with index) — the drag counterpart of the
  // sheet's moveCard. Re-sequences sortOrder locally exactly the way the
  // server will, then reconciles or rolls back.
  const moveCardTo = useCallback(
    async (taskId: string, toListId: string, toIndex: number) => {
      if (!data || isTemp(taskId) || isTemp(toListId)) return;
      const snapshot = data;
      setData((prev) => {
        if (!prev) return prev;
        const t = prev.tasks.find((x) => x.id === taskId);
        if (!t) return prev;
        const without = prev.tasks.filter((x) => x.id !== taskId);
        const target = without
          .filter((x) => x.listId === toListId)
          .sort((a, b) => a.sortOrder - b.sortOrder);
        target.splice(Math.min(toIndex, target.length), 0, {
          ...t,
          listId: toListId,
        });
        const reseqTarget = target.map((x, i) => ({ ...x, sortOrder: i }));
        let rest = without.filter((x) => x.listId !== toListId);
        if (t.listId !== toListId) {
          const src = rest
            .filter((x) => x.listId === t.listId)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((x, i) => ({ ...x, sortOrder: i }));
          rest = [...rest.filter((x) => x.listId !== t.listId), ...src];
        }
        return { ...prev, tasks: [...rest, ...reseqTarget] };
      });
      try {
        await partnerMoveTask(taskId, { toListId, toIndex });
      } catch (err) {
        setData(snapshot);
        Alert.alert(
          "Couldn't move card",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data]
  );

  const dnd = useBoardDnd({
    listWidth,
    screenWidth: windowWidth,
    lists: sortedLists,
    tasksByList,
    isTemp,
    onMove: moveCardTo,
  });

  // Reorder whole columns (the list-header drag). Rewrites every list's
  // sortOrder to its index in the dropped order — the exact thing the
  // server does — then persists. On any failure we snap back to the
  // pre-drag order and surface an Alert. Skips if a temp (unsaved) list is
  // in the mix, since those have no server id yet.
  const reorderLists = useCallback(
    async (orderedListIds: string[]) => {
      if (!data) return;
      if (orderedListIds.some((lid) => isTemp(lid))) return;
      const snapshot = data;
      const rank = new Map(orderedListIds.map((lid, i) => [lid, i]));
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          lists: prev.lists.map((l) =>
            rank.has(l.id) ? { ...l, sortOrder: rank.get(l.id)! } : l
          ),
        };
      });
      try {
        await partnerReorderLists(boardId, orderedListIds);
      } catch (err) {
        setData(snapshot);
        Alert.alert(
          "Couldn't reorder lists",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data, boardId, isTemp]
  );

  const listDnd = useListDnd({
    listWidth,
    screenWidth: windowWidth,
    lists: sortedLists,
    isTemp,
    onReorder: reorderLists,
    // Share the one horizontal scroller the card hook already owns.
    hScrollRef: dnd.hScrollRef,
    hScrollOffset: dnd.hScrollOffset,
  });

  // Cross-user resyncs mid-drag would yank the board out from under the
  // finger — hold them until the drop lands (either a card or a column).
  const isDraggingRef = useRef(false);
  isDraggingRef.current = dnd.isDragging || listDnd.isDragging;

  // Either drag in flight disables the scrollers and snapping.
  const anyDragging = dnd.isDragging || listDnd.isDragging;

  // While a column drag is live, render columns in the preview order so the
  // siblings physically shift to make room; otherwise honour sortOrder.
  const renderLists = useMemo(() => {
    if (!listDnd.previewOrder) return sortedLists;
    const byId = new Map(sortedLists.map((l) => [l.id, l]));
    const ordered: CanvasList[] = [];
    for (const lid of listDnd.previewOrder) {
      const l = byId.get(lid);
      if (l) ordered.push(l);
    }
    // Any list created mid-drag (optimistic temp) isn't in previewOrder —
    // keep it visible by appending in its existing relative position.
    if (ordered.length !== sortedLists.length) {
      for (const l of sortedLists) {
        if (!listDnd.previewOrder.includes(l.id)) ordered.push(l);
      }
    }
    return ordered;
  }, [listDnd.previewOrder, sortedLists]);

  /* ─── Mutations: optimistic ─── */
  const addList = useCallback(
    async (title: string) => {
      if (!data) return;
      const tmp = tempId();
      const optimistic: CanvasList = {
        id: tmp,
        title,
        sortOrder: data.lists.length,
        position: { x: 0, y: 0 },
        width: listWidth,
        color: null,
      };
      setData((prev) =>
        prev
          ? {
              ...prev,
              lists: [...prev.lists, optimistic],
            }
          : prev
      );
      try {
        const res = await partnerCreateList(boardId, { title });
        setData((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            lists: prev.lists.map((l) =>
              l.id === tmp
                ? { ...l, id: res.list.id, sortOrder: res.list.sortOrder }
                : l
            ),
          };
        });
      } catch (err) {
        setData((prev) =>
          prev
            ? { ...prev, lists: prev.lists.filter((l) => l.id !== tmp) }
            : prev
        );
        Alert.alert(
          "Couldn't create list",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data, boardId, listWidth]
  );

  const addCard = useCallback(
    async (listId: string, title: string) => {
      if (!data) return;
      const tmp = tempId();
      const optimistic: PreviewTask = {
        id: tmp,
        listId,
        title,
        description: "",
        sortOrder: Number.MAX_SAFE_INTEGER,
        assignee: null,
        dueDate: null,
        priority: null,
        checklistSummary: { totalChecklists: 0, totalItems: 0, doneItems: 0 },
        hasDescription: false,
        updatedAt: new Date().toISOString(),
      };
      setData((prev) =>
        prev ? { ...prev, tasks: [...prev.tasks, optimistic] } : prev
      );
      try {
        const res = await partnerCreateTask(boardId, { listId, title });
        setData((prev) =>
          prev
            ? {
                ...prev,
                tasks: prev.tasks.map((t) =>
                  t.id === tmp ? (res.task as PreviewTask) : t
                ),
              }
            : prev
        );
      } catch (err) {
        setData((prev) =>
          prev
            ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== tmp) }
            : prev
        );
        Alert.alert(
          "Couldn't add card",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data, boardId]
  );

  const moveCard = useCallback(
    async (taskId: string, toListId: string) => {
      if (!data) return;
      // Optimistic: update locally first
      setData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === taskId ? { ...t, listId: toListId } : t
          ),
        };
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        const dest = data.tasks.filter(
          (t) => t.listId === toListId && t.id !== taskId
        );
        await partnerMoveTask(taskId, {
          toListId,
          toIndex: dest.length,
        });
      } catch (err) {
        // rollback
        load();
        Alert.alert(
          "Couldn't move card",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data, load]
  );

  const deleteCard = useCallback(
    async (task: PreviewTask) => {
      // Snapshot for rollback
      const snapshot = data;
      setData((prev) =>
        prev ? { ...prev, tasks: prev.tasks.filter((t) => t.id !== task.id) } : prev
      );
      try {
        await partnerDeleteTask(task.id);
      } catch (err) {
        // Restore on any failure (network, 403, …)
        setData(snapshot);
        const reqd = deleteRequestRequired(err);
        if (reqd) {
          setRequestTarget(reqd);
          return;
        }
        Alert.alert(
          "Couldn't delete card",
          err instanceof ApiError ? err.message : "Try again."
        );
      }
    },
    [data]
  );

  /* ─── Header data ─── */
  const board = data?.board;
  const styles = board
    ? BOARD_COLOR_STYLES[board.color] ?? BOARD_COLOR_STYLES.copper
    : BOARD_COLOR_STYLES.copper;
  const totalLists = data?.lists.length ?? 0;
  const totalCards = data?.tasks.length ?? 0;

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <Header
          title={board?.title ?? "…"}
          accent={styles.accent}
          gradient={styles.gradient}
          totalLists={totalLists}
          totalCards={totalCards}
          presenceCount={presence.length}
          unreadCount={live.unreadCount + pendingCount}
          onBack={() => router.back()}
          onExport={data ? () => setExporting(true) : null}
          onSettings={data ? () => setSettingsOpen(true) : null}
          onBell={
            isPartnerAdmin
              ? () => {
                  live.markSeen();
                  router.push(
                    `/(home)/workflow/${boardId}/activity` as never
                  );
                }
              : null
          }
        />

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center px-8">
            <Feather name="alert-circle" size={28} color="#c14a37" />
            <Text
              className="mt-3 text-[14px] text-app-fg-soft text-center"
              style={{ fontFamily: "Manrope" }}
            >
              {error}
            </Text>
            <Pressable
              onPress={load}
              className="mt-4 rounded-md px-4 py-2 active:opacity-50"
              style={{ backgroundColor: "#0a1124" }}
            >
              <Text
                className="text-[12px]"
                style={{
                  fontFamily: "Manrope-SemiBold",
                  color: "#f5ebd6",
                }}
              >
                Retry
              </Text>
            </Pressable>
          </View>
        ) : (
          <Animated.ScrollView
            ref={dnd.hScrollRef}
            onScroll={dnd.hScrollHandler}
            onLayout={(e) => setBoardViewportH(e.nativeEvent.layout.height)}
            scrollEventThrottle={16}
            scrollEnabled={!anyDragging}
            horizontal
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            // Free scroll once three-plus columns fit; snapping fights
            // the user when the viewport already shows several lists.
            // Snapping also pauses mid-drag (card OR column) so autoscroll
            // lands cleanly.
            snapToInterval={
              isExpanded || anyDragging ? undefined : listWidth + 12
            }
            snapToAlignment="start"
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingVertical: BOARD_V_PADDING,
              gap: 12,
              alignItems: "flex-start",
            }}
            // No RefreshControl here — see the note on the column below.
            // A pull-to-refresh on a HORIZONTAL scroller swallows every
            // downward drag on the board, including the ones meant for
            // the list you're reading.
          >
            {renderLists.map((list) => (
              <ListColumn
                key={list.id}
                list={list}
                listWidth={listWidth}
                viewportH={boardViewportH}
                refreshing={refreshing}
                onRefresh={onRefresh}
                anyDragging={anyDragging}
                tasks={tasksByList.get(list.id) || []}
                edges={
                  edgesByList.get(list.id) || {
                    incoming: [],
                    outgoing: [],
                  }
                }
                listTitleById={listTitleById}
                accent={styles.accent}
                dnd={dnd}
                columnGesture={listDnd.makeColumnGesture(
                  list,
                  (tasksByList.get(list.id) || []).length,
                  composingListId !== list.id
                )}
                onComposingChange={(open) =>
                  setComposingListId(open ? list.id : null)
                }
                isColumnDragging={listDnd.draggingListId === list.id}
                onAddCard={(title) => addCard(list.id, title)}
                onCardPress={(task) =>
                  router.push(
                    `/(home)/workflow/${boardId}/card/${task.id}` as never
                  )
                }
                onCardLongPress={(task) => setActiveCard(task)}
              />
            ))}
            <AddListComposer
              accent={styles.accent}
              width={listWidth}
              onSubmit={(title) => addList(title)}
            />
            {/* trailing spacer so the last list doesn't sit flush with the edge */}
            <View style={{ width: 4 }} />
          </Animated.ScrollView>
        )}
      </SafeAreaView>

      {/* Long-press sheet */}
      <CardActionsSheet
        visible={Boolean(activeCard)}
        cardTitle={activeCard?.title ?? ""}
        currentListId={activeCard?.listId ?? ""}
        lists={(data?.lists ?? []).map((l) => ({ id: l.id, title: l.title }))}
        onClose={() => setActiveCard(null)}
        onMoveToList={(toId) => {
          if (activeCard) moveCard(activeCard.id, toId);
        }}
        onOpen={() => {
          if (activeCard) {
            router.push(
              `/(home)/workflow/${boardId}/card/${activeCard.id}` as never
            );
          }
        }}
        onDelete={() => {
          if (activeCard) deleteCard(activeCard);
        }}
      />

      {/* Smart-delete reason sheet */}
      <RequestDeleteSheet
        target={requestTarget}
        onClose={() => setRequestTarget(null)}
        onSubmitted={() => {
          setRequestTarget(null);
          Alert.alert(
            "Sent for review",
            "The office admin has been notified."
          );
        }}
      />

      {board ? (
        <BoardSettingsSheet
          visible={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          boardId={boardId}
          title={board.title}
          description={board.description}
          color={board.color}
          onSaved={({ title, description, color }) =>
            setData((prev) =>
              prev
                ? {
                    ...prev,
                    board: { ...prev.board, title, description, color },
                  }
                : prev
            )
          }
          onDeleted={() => router.back()}
          onDeleteNeedsRequest={(target) => setRequestTarget(target)}
        />
      ) : null}

      {/* Save menu: Picture / Document (native snapshot) / Data (xlsx) */}
      <BoardExportSheet
        visible={exporting}
        onClose={() => setExporting(false)}
        contextLine={`${totalLists} lists · ${totalCards} cards`}
        exportXlsx={() => exportBoardXlsx(boardId, board?.title ?? "board")}
        capture={capture}
      />

      {/* Capture rig — attached, opaque, occluded. Android only
          photographs views that are really laid out on screen. */}
      {snapshotting && data ? (
        <>
          <BoardSnapshotView
            data={data}
            accent={styles.accent}
            innerRef={snapshotInnerRef}
            onReady={(w, h) => snapshotReadyRef.current?.({ w, h })}
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "#f4ede0",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator color="#c5853a" size="large" />
            <Text
              className="mt-3 text-[12px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.6,
                color: "#8a5821",
              }}
            >
              Preparing snapshot…
            </Text>
          </View>
        </>
      ) : null}

      {/* Drag clones — float above everything while a card or a whole
          column is in hand. Only one is ever non-null at a time. */}
      {dnd.overlay}
      {listDnd.overlay}
    </View>
  );
}

/* ─── Header ─── */

function Header({
  title,
  accent,
  gradient,
  totalLists,
  totalCards,
  presenceCount,
  unreadCount,
  onBack,
  onExport,
  onSettings,
  onBell,
}: {
  title: string;
  accent: string;
  gradient: readonly string[] | string[];
  totalLists: number;
  totalCards: number;
  presenceCount: number;
  unreadCount: number;
  onBack: () => void;
  onExport?: (() => void) | null;
  onSettings?: (() => void) | null;
  onBell: (() => void) | null;
}) {
  return (
    <View
      className="border-b border-app-edge bg-app-canvas px-4 pt-2 pb-3 flex-row items-center"
      style={{ gap: 10 }}
    >
      <Pressable
        onPress={onBack}
        hitSlop={10}
        className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
        style={{ backgroundColor: "#ffffff" }}
        accessibilityLabel="Back"
      >
        <Feather name="arrow-left" size={17} color="#0a1124" />
      </Pressable>
      <View
        className="h-9 w-9 items-center justify-center rounded-md"
        style={{ overflow: "hidden" }}
      >
        <LinearGradient
          colors={gradient as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 6,
          }}
        />
        <Feather name="grid" size={15} color="#ffffff" />
      </View>
      <View className="flex-1 min-w-0">
        <Text
          className="text-[9px] uppercase text-app-copper-deep"
          style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.6 }}
        >
          Workflow
        </Text>
        <Text
          className="text-[15px] tracking-tight text-app-ink"
          style={{ fontFamily: "Crimson-SemiBold" }}
          numberOfLines={1}
        >
          {title}
        </Text>
      </View>

      {/* Stats chip */}
      <View
        className="rounded-md px-2 py-1"
        style={{ backgroundColor: "#efe5d0" }}
      >
        <Text
          className="text-[10px] tabular-nums uppercase"
          style={{
            fontFamily: "DMMono-Medium",
            letterSpacing: 0.6,
            color: "#4d4538",
          }}
        >
          <Text style={{ color: "#0a1124" }}>{totalLists}</Text> ·{" "}
          <Text style={{ color: "#0a1124" }}>{totalCards}</Text>
        </Text>
      </View>

      {/* Presence dot */}
      {presenceCount > 1 ? (
        <View className="flex-row items-center" style={{ gap: 4 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: "#56a0a8",
            }}
          />
          <Text
            className="text-[10px]"
            style={{ fontFamily: "DMMono-Medium", color: "#4d4538" }}
          >
            {presenceCount}
          </Text>
        </View>
      ) : null}

      {/* Export */}
      {onExport ? (
        <Pressable
          onPress={onExport}
          hitSlop={6}
          className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
          style={{ backgroundColor: "#ffffff" }}
          accessibilityLabel="Export board data"
        >
          <Feather name="download" size={15} color="#0a1124" />
        </Pressable>
      ) : null}

      {/* Settings */}
      {onSettings ? (
        <Pressable
          onPress={onSettings}
          hitSlop={6}
          className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
          style={{ backgroundColor: "#ffffff" }}
          accessibilityLabel="Board settings"
        >
          <Feather name="more-horizontal" size={15} color="#0a1124" />
        </Pressable>
      ) : null}

      {/* Bell — office admin only; it opens the audit trail and the
          delete-request queue, neither of which is a junior's to read. */}
      {onBell ? (
      <Pressable
        onPress={onBell}
        hitSlop={6}
        className="relative active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
        style={{ backgroundColor: "#ffffff" }}
        accessibilityLabel="Open activity"
      >
        <Feather name="bell" size={15} color="#0a1124" />
        {unreadCount > 0 ? (
          <View
            style={{
              position: "absolute",
              top: -4,
              right: -4,
              minWidth: 16,
              height: 16,
              paddingHorizontal: 4,
              borderRadius: 8,
              backgroundColor: "#c14a37",
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 2,
              borderColor: "#f4ede0",
            }}
          >
            <Text
              style={{
                fontFamily: "DMMono-Medium",
                fontSize: 9,
                color: "#ffffff",
              }}
            >
              {unreadCount > 99 ? "99" : unreadCount}
            </Text>
          </View>
        ) : null}
      </Pressable>
      ) : null}
    </View>
  );
}

/* ─── List column ─── */

function ListColumn({
  list,
  listWidth,
  viewportH,
  refreshing,
  onRefresh,
  anyDragging,
  tasks,
  edges,
  listTitleById,
  accent,
  dnd,
  columnGesture,
  isColumnDragging,
  onAddCard,
  onComposingChange,
  onCardPress,
  onCardLongPress,
}: {
  list: CanvasList;
  listWidth: number;
  // Measured height of the board scroller, or null until it has laid out.
  viewportH: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** A card or a column is in hand somewhere on the board. */
  anyDragging: boolean;
  tasks: PreviewTask[];
  edges: { incoming: CanvasEdge[]; outgoing: CanvasEdge[] };
  listTitleById: Map<string, string>;
  accent: string;
  dnd: ReturnType<typeof useBoardDnd>;
  columnGesture: ReturnType<ReturnType<typeof useListDnd>["makeColumnGesture"]>;
  isColumnDragging: boolean;
  onAddCard: (title: string) => void;
  onComposingChange: (open: boolean) => void;
  onCardPress: (task: PreviewTask) => void;
  onCardLongPress: (task: PreviewTask) => void;
}) {
  const stripe = list.color || accent;
  const isPending = isTemp(list.id);
  const { height: winH } = useWindowDimensions();
  // Hug content like the web column, but never grow past the scroller that
  // holds us.
  //
  // This used to be `winH - 240` — a guess, and on most phones a wrong one.
  // The real viewport is the window minus the status bar, the header, the
  // tab bar (which is 66 + the bottom inset, and taller again with 3-button
  // navigation) and this scroller's own padding. Whenever that came to more
  // than 240, a full column overflowed BELOW the visible area — and because
  // the parent only scrolls horizontally, the cards down there and the
  // add-card composer under them were simply unreachable.
  //
  // So measure instead: the scroller reports its height on layout and the
  // column caps to it, minus the 14px of vertical padding at each end. The
  // window-based figure survives only as the value for the single frame
  // before that measurement arrives.
  const colMaxHeight = viewportH
    ? Math.max(220, viewportH - BOARD_V_PADDING * 2)
    : Math.max(300, winH - 240);
  const bodyRef = useRef<ScrollView | null>(null);
  const dropHere =
    dnd.dropTarget && dnd.dropTarget.listId === list.id
      ? dnd.dropTarget.index
      : null;

  return (
    // The gesture wraps the entire column: press and hold anywhere on a
    // list — header, gaps, over the cards, the empty space below them —
    // and the whole thing lifts. Cards keep their own drag because their
    // long-press fires first (300ms vs 450ms), so a finger on a card
    // always takes the card and never the column.
    <GestureDetector gesture={columnGesture}>
    <View
      collapsable={false}
      style={{
        width: listWidth,
        maxHeight: colMaxHeight,
        backgroundColor: "rgba(255,255,255,0.92)",
        borderRadius: 14,
        overflow: "hidden",
        // While this column is the one in hand, it leaves a dashed, dimmed
        // "ghost slot" where it sits in the preview order; the floating
        // clone carries the live header above the board.
        opacity: isColumnDragging ? 0.32 : isPending ? 0.7 : 1,
        borderWidth: isColumnDragging ? 1.5 : 0,
        borderStyle: "dashed",
        borderColor: isColumnDragging ? "#c5853a" : "transparent",
        shadowColor: "#0a1124",
        shadowOpacity: 0.08,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 },
        elevation: 3,
      }}
    >
      {/* Top stripe + title. No gesture of its own any more — the whole
          column is the grip. */}
      <View>
          <View style={{ height: 4, backgroundColor: stripe }} />

          {/* Header (long-press here to lift the whole column) */}
          <View
            className="px-3 pt-3 pb-2 flex-row items-center"
            style={{ gap: 6 }}
          >
            <Text
              className="flex-1 text-[16px] tracking-tight text-app-ink"
              style={{ fontFamily: "Crimson-SemiBold" }}
              numberOfLines={1}
            >
              {list.title}
            </Text>
            {tasks.length > 0 ? (
              <View
                className="rounded px-1.5"
                style={{ backgroundColor: "#efe5d0" }}
              >
                <Text
                  className="text-[11px] tabular-nums"
                  style={{
                    fontFamily: "DMMono-Medium",
                    color: "#4d4538",
                    letterSpacing: 0.4,
                  }}
                >
                  {tasks.length}
                </Text>
              </View>
            ) : null}
            {/* Grip affordance — signals the header is draggable */}
            {!isPending ? (
              <Feather name="more-vertical" size={13} color="#c0b69c" />
            ) : null}
          </View>
      </View>

      {/* Edges chips */}
      {(edges.incoming.length > 0 || edges.outgoing.length > 0) && (
        <View className="px-3 pb-1" style={{ gap: 4 }}>
          {edges.incoming.slice(0, 2).map((e) => (
            <EdgePill
              key={`in-${e.id}`}
              direction="incoming"
              label={e.label || undefined}
              otherListTitle={listTitleById.get(e.sourceListId) ?? "another"}
              color={e.color || stripe}
            />
          ))}
          {edges.outgoing.slice(0, 2).map((e) => (
            <EdgePill
              key={`out-${e.id}`}
              direction="outgoing"
              label={e.label || undefined}
              otherListTitle={listTitleById.get(e.targetListId) ?? "another"}
              color={e.color || stripe}
            />
          ))}
        </View>
      )}

      {/* Cards body — scrolls vertically inside the list */}
      <ScrollView
        ref={(r) => {
          bodyRef.current = r;
          dnd.setColumnScrollRef(list.id, r);
        }}
        onLayout={(e) => {
          dnd.setColumnViewportH(list.id, e.nativeEvent.layout.height);
          // Window-space top for the drag hit-test (Y never changes with
          // horizontal scrolling, so one measure per layout is enough).
          // ScrollView's TS type hides NativeMethods; the host component
          // has them at runtime.
          (
            bodyRef.current as unknown as
              | { measureInWindow(cb: (x: number, y: number) => void): void }
              | null
          )?.measureInWindow((_x: number, y: number) =>
            dnd.setColumnWindowTop(list.id, y)
          );
        }}
        onScroll={(e) =>
          dnd.onColumnScroll(list.id, e.nativeEvent.contentOffset.y)
        }
        scrollEventThrottle={16}
        // Frozen while anything is in hand: a card mid-drag, or this whole
        // column — otherwise the cards would slide under the finger that's
        // carrying the column.
        scrollEnabled={!dnd.isDragging && !isColumnDragging}
        // Pull-to-refresh belongs HERE, on the vertical scroller, not on
        // the horizontal board around it.
        //
        // On Android a RefreshControl wraps its scroller in a
        // SwipeRefreshLayout, which starts refreshing whenever the child
        // "can't scroll up". A horizontal ScrollView can never scroll up,
        // so the board's refresh answered every downward drag anywhere on
        // it — including inside a list already scrolled to the bottom.
        // Reading to the end of a long list and swiping back up refreshed
        // the board instead of scrolling, which is exactly what chambers
        // reported. On a vertical scroller the same check means what it
        // says: only a list already at its top starts a refresh.
        //
        // Disabled mid-drag so carrying a card downward past the top of a
        // list can't turn into a pull.
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            enabled={!anyDragging}
            tintColor="#c5853a"
          />
        }
        style={{ flexShrink: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 8,
          paddingTop: 4,
          paddingBottom: 4,
          gap: 6,
        }}
        showsVerticalScrollIndicator={false}
      >
        {tasks.length === 0 ? (
          <View
            className="items-center justify-center"
            style={{
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: "#e3d9c0",
              borderRadius: 8,
              paddingVertical: 18,
            }}
          >
            <Text
              className="text-[10px] uppercase"
              style={{
                fontFamily: "DMMono-Medium",
                letterSpacing: 1.4,
                color: "#a89c80",
              }}
            >
              Empty
            </Text>
          </View>
        ) : (
          (() => {
            // The hit-test indexes cards EXCLUDING the dragged one, so
            // indicator placement walks the same exclusive sequence.
            const dragId = dnd.draggingTaskId;
            let exclusive = 0;
            const nodes = tasks.map((t) => {
              const isDragged = t.id === dragId;
              const showBefore = !isDragged && dropHere === exclusive;
              const node = (
                <View
                  key={t.id}
                  // y is relative to the scroll content — exactly the
                  // space the hit-test works in.
                  onLayout={(e) =>
                    dnd.registerCardLayout(
                      list.id,
                      t.id,
                      e.nativeEvent.layout.y,
                      e.nativeEvent.layout.height
                    )
                  }
                >
                  {showBefore ? (
                    <View style={{ marginBottom: 6 }}>
                      <DropIndicator />
                    </View>
                  ) : null}
                  <GestureDetector gesture={dnd.makeGesture(t)}>
                    <View
                      collapsable={false}
                      style={{ opacity: isDragged ? 0.35 : 1 }}
                    >
                      <CardItem
                        task={t}
                        onPress={() => onCardPress(t)}
                        onMore={() => onCardLongPress(t)}
                      />
                    </View>
                  </GestureDetector>
                </View>
              );
              if (!isDragged) exclusive += 1;
              return node;
            });
            return (
              <>
                {nodes}
                {dropHere !== null && dropHere >= exclusive ? (
                  <DropIndicator />
                ) : null}
              </>
            );
          })()
        )}

        {/* Composer rides inside the scroll so it sits directly after the
            last card (web parity) instead of pinned to the column bottom. */}
        <AddCardComposer
          onSubmit={onAddCard}
          onOpenChange={onComposingChange}
        />
      </ScrollView>
    </View>
    </GestureDetector>
  );
}
