import { useCallback, useEffect, useRef, useState } from "react";
import {
  ScrollView,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  Alert,
  RefreshControl,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Sheet from "./Sheet";
import {
  partnerListDeleteRequests,
  partnerActivityHistory,
  partnerApproveDeleteRequest,
  partnerRejectDeleteRequest,
  ApiError,
  type DeleteRequestRow,
  type ActivityHistoryRow,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { openSection } from "../lib/navigation";
import { withReturn } from "./useReturnTo";
import { useNotificationCount } from "../lib/notification-count";

// Bell-icon sheet. Replaces the web's BellDropdown for mobile.
//
// Two tabs:
//  - Requests — admins see every pending delete request in chambers
//    with inline Approve / Reject actions; non-admins see their own
//    requests across statuses so they can track what they've asked for.
//  - Activity — partner-wide activity, a page at a time, with the full
//    filterable feed a tap away on its own screen. Admin-only, because
//    the endpoint behind it is: the office audit trail isn't a junior's
//    to read, and asking for it as one used to 403 the whole sheet and
//    take the Requests tab down with it.
//
// Polls every 12s while open so an admin reviewing a queue sees new
// requests land without re-opening. Pauses when closed.

const POLL_INTERVAL_MS = 12_000;
// Fifty rows, not twenty-five. Chambers reported that notifications "only
// stay for one day" no matter what retention was set to — but nothing was
// being pruned: twenty-five rows simply IS about a day for a busy office,
// and there was no way to ask for the twenty-sixth. Hence the page size
// and the Load more below it.
const ACTIVITY_PAGE = 50;

type Props = {
  visible: boolean;
  onClose: () => void;
};

type Tab = "requests" | "activity";

export default function BellSheet({ visible, onClose }: Props) {
  const { isPartnerAdmin } = useAuth();
  const { refresh: refreshBadge } = useNotificationCount();

  const [tab, setTab] = useState<Tab>("requests");
  const [requests, setRequests] = useState<DeleteRequestRow[]>([]);
  const [activity, setActivity] = useState<ActivityHistoryRow[]>([]);
  const [activityCursor, setActivityCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // How many pages of ledger are on screen. Once it's more than one the
  // 12-second poll leaves the Activity tab alone — refetching page one
  // would collapse the history back under the reader's thumb.
  const pagesRef = useRef(1);
  // Track which requests the admin has acted on so the row can hide
  // immediately, before the next poll confirms — feels responsive.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  // Track which request is in "reject reason" mode (only one at a
  // time; opening another collapses the first).
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  // Cancel-on-unmount guard for in-flight fetches. Without it, a
  // closing sheet that races with a slow poll could setState on an
  // unmounted component.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const fetchAll = useCallback(
    async (mode: "initial" | "poll" | "pull"): Promise<void> => {
      try {
        // Non-admins see all their request statuses so they can track
        // what they've filed. Admins focus on what needs review.
        const requestsP = isPartnerAdmin
          ? partnerListDeleteRequests({ status: "pending", limit: 30 })
          : partnerListDeleteRequests({ limit: 30 });
        // The ledger is admin-only server-side, and a poll that would
        // rewind a reader's place in it isn't worth making.
        const wantActivity =
          isPartnerAdmin && (mode !== "poll" || pagesRef.current === 1);
        const [req, act] = await Promise.all([
          requestsP,
          wantActivity
            ? partnerActivityHistory({ limit: ACTIVITY_PAGE })
            : null,
        ]);
        if (!aliveRef.current) return;
        setRequests(req.requests);
        if (act) {
          pagesRef.current = 1;
          setActivity(act.activity);
          setActivityCursor(act.nextCursor);
          setActivityHasMore(act.hasMore);
        }
        setError(null);
      } catch (err) {
        if (!aliveRef.current) return;
        // Only show the error on the user-initiated paths. Silent
        // failures during background polls are intentional — surfacing
        // a banner every 12s when the network blips would be noise.
        if (mode !== "poll") {
          setError(
            err instanceof Error ? err.message : "Couldn't load notifications."
          );
        }
      }
    },
    [isPartnerAdmin]
  );

  // Open lifecycle: fetch once on open, poll while visible, clean up
  // on close. Resetting state on close keeps a fresh load every time
  // the user pulls the sheet up — the data is light enough that a
  // re-fetch is cheaper than staleness.
  const loadMoreActivity = useCallback(async () => {
    if (!activityCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await partnerActivityHistory({
        limit: ACTIVITY_PAGE,
        before: activityCursor,
      });
      if (!aliveRef.current) return;
      pagesRef.current += 1;
      setActivity((prev) => [...prev, ...res.activity]);
      setActivityCursor(res.nextCursor);
      setActivityHasMore(res.hasMore);
    } catch {
      // Keep what's already on screen; the button stays for a retry.
    } finally {
      if (aliveRef.current) setLoadingMore(false);
    }
  }, [activityCursor, loadingMore]);

  useEffect(() => {
    if (!visible) {
      setLoading(true);
      setRejectingId(null);
      setRemovingIds(new Set());
      // A fresh open starts at the top of the ledger again.
      pagesRef.current = 1;
      return;
    }
    let timer: ReturnType<typeof setInterval> | null = null;
    (async () => {
      await fetchAll("initial");
      if (aliveRef.current) setLoading(false);
    })();
    timer = setInterval(() => {
      fetchAll("poll");
    }, POLL_INTERVAL_MS);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [visible, fetchAll]);

  const onPullRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAll("pull");
    if (aliveRef.current) setRefreshing(false);
  }, [fetchAll]);

  const onApprove = useCallback(
    async (id: string) => {
      // Optimistic hide. If the call fails we'll re-add via the next
      // re-fetch (or could push it back into state; for now relying on
      // the re-fetch on error is simpler).
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined
      );
      setRemovingIds((s) => new Set(s).add(id));
      try {
        await partnerApproveDeleteRequest(id);
        refreshBadge();
        // The next poll within POLL_INTERVAL_MS will refresh the list;
        // the optimistic hide makes the action feel instant. Don't
        // mutate `requests` here — it'd briefly show the row reappear
        // before the poll syncs.
      } catch (err) {
        if (!aliveRef.current) return;
        setRemovingIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        Alert.alert(
          "Couldn't approve",
          err instanceof ApiError
            ? err.message
            : "Network error. Try again."
        );
      }
    },
    [refreshBadge]
  );

  const onReject = useCallback(
    async (id: string, note: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
        () => undefined
      );
      setRemovingIds((s) => new Set(s).add(id));
      setRejectingId(null);
      try {
        await partnerRejectDeleteRequest(id, note.trim());
        refreshBadge();
      } catch (err) {
        if (!aliveRef.current) return;
        setRemovingIds((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
        Alert.alert(
          "Couldn't reject",
          err instanceof ApiError
            ? err.message
            : "Network error. Try again."
        );
      }
    },
    [refreshBadge]
  );

  const visibleRequests = requests.filter((r) => !removingIds.has(r.id));
  const pendingCount = isPartnerAdmin
    ? visibleRequests.length
    : visibleRequests.filter((r) => r.status === "pending").length;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      eyebrow="Bell"
      title="Notifications"
      containerStyle={{ height: "75%" }}
    >
      <View style={styles.tabRow}>
        <TabButton
          label="Requests"
          active={tab === "requests"}
          badge={pendingCount}
          onPress={() => setTab("requests")}
        />
        {/* Activity is the office's audit trail — admin-only, here as it
            is on the server. */}
        {isPartnerAdmin ? (
          <TabButton
            label="Activity"
            active={tab === "activity"}
            onPress={() => setTab("activity")}
          />
        ) : null}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.scrollBody}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onPullRefresh}
            tintColor="#c5853a"
          />
        }
      >
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#c5853a" />
          </View>
        ) : tab === "requests" || !isPartnerAdmin ? (
          <RequestsTab
            isAdmin={isPartnerAdmin}
            rows={visibleRequests}
            rejectingId={rejectingId}
            onStartReject={setRejectingId}
            onCancelReject={() => setRejectingId(null)}
            onApprove={onApprove}
            onReject={onReject}
          />
        ) : (
          <ActivityTab
            rows={activity}
            hasMore={activityHasMore}
            loadingMore={loadingMore}
            onLoadMore={loadMoreActivity}
            onOpenBoard={(boardId) => {
              onClose();
              // The bell only lives on the dashboard, so that's where
              // the board's back should return.
              openSection(
                withReturn(`/(home)/workflow/${boardId}`, "home") as never
              );
            }}
            onOpenLedger={() => {
              onClose();
              openSection("/(home)/activity" as never);
            }}
          />
        )}
      </ScrollView>
    </Sheet>
  );
}

/* ──────────────────── Tabs ──────────────────── */

function TabButton({
  label,
  active,
  badge,
  onPress,
}: {
  label: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.tabButton,
        active ? styles.tabButtonActive : null,
      ]}
      hitSlop={6}
    >
      <Text style={[styles.tabLabel, active ? styles.tabLabelActive : null]}>
        {label}
      </Text>
      {badge !== undefined && badge > 0 ? (
        <View
          style={[
            styles.tabBadge,
            active ? styles.tabBadgeActive : null,
          ]}
        >
          <Text
            style={[
              styles.tabBadgeText,
              active ? styles.tabBadgeTextActive : null,
            ]}
          >
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

/* ──────────────────── Requests tab ──────────────────── */

function RequestsTab({
  isAdmin,
  rows,
  rejectingId,
  onStartReject,
  onCancelReject,
  onApprove,
  onReject,
}: {
  isAdmin: boolean;
  rows: DeleteRequestRow[];
  rejectingId: string | null;
  onStartReject: (id: string) => void;
  onCancelReject: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string, note: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="check-circle"
        title={isAdmin ? "Nothing to review." : "No requests on file."}
        body={
          isAdmin
            ? "When someone files a delete request, it'll appear here for your sign-off."
            : "When you ask to delete something the admin owns, the request will show up here."
        }
      />
    );
  }
  return (
    <View style={{ gap: 12 }}>
      {rows.map((r) => (
        <RequestRow
          key={r.id}
          row={r}
          isAdmin={isAdmin}
          rejecting={rejectingId === r.id}
          onStartReject={() => onStartReject(r.id)}
          onCancelReject={onCancelReject}
          onApprove={() => onApprove(r.id)}
          onConfirmReject={(note) => onReject(r.id, note)}
        />
      ))}
    </View>
  );
}

function RequestRow({
  row,
  isAdmin,
  rejecting,
  onStartReject,
  onCancelReject,
  onApprove,
  onConfirmReject,
}: {
  row: DeleteRequestRow;
  isAdmin: boolean;
  rejecting: boolean;
  onStartReject: () => void;
  onCancelReject: () => void;
  onApprove: () => void;
  onConfirmReject: (note: string) => void;
}) {
  const [note, setNote] = useState("");

  const targetLabel = row.targetType.charAt(0).toUpperCase() + row.targetType.slice(1);
  const showActions = isAdmin && row.status === "pending";

  return (
    <View style={styles.requestCard}>
      <View style={styles.requestHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsOf(row.requesterName)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.requestActor} numberOfLines={1}>
            {row.requesterName}
          </Text>
          <Text style={styles.requestMeta} numberOfLines={1}>
            {timeAgo(row.createdAt)} · {targetLabel}
          </Text>
        </View>
        <StatusPill status={row.status} />
      </View>

      <Text style={styles.requestBody}>
        wants to delete{" "}
        <Text style={styles.requestTarget}>{row.targetName}</Text>
      </Text>

      {row.reason ? (
        <View style={styles.reasonBlock}>
          <Text style={styles.reasonLabel}>Reason</Text>
          <Text style={styles.reasonText}>{row.reason}</Text>
        </View>
      ) : null}

      {row.reviewedByName && row.status !== "pending" ? (
        <Text style={styles.reviewerLine}>
          {row.status === "approved" ? "Approved" : "Rejected"} by{" "}
          {row.reviewedByName}
          {row.reviewerNote ? ` — "${row.reviewerNote}"` : ""}
        </Text>
      ) : null}

      {showActions && !rejecting ? (
        <View style={styles.actionRow}>
          <Pressable
            onPress={onStartReject}
            style={[styles.actionBtn, styles.rejectBtn]}
            hitSlop={4}
          >
            <Feather name="x" size={14} color="#0a1124" />
            <Text style={[styles.actionLabel, { color: "#0a1124" }]}>
              Reject
            </Text>
          </Pressable>
          <Pressable
            onPress={onApprove}
            style={[styles.actionBtn, styles.approveBtn]}
            hitSlop={4}
          >
            <Feather name="check" size={14} color="#f5ebd6" />
            <Text style={[styles.actionLabel, { color: "#f5ebd6" }]}>
              Approve & delete
            </Text>
          </Pressable>
        </View>
      ) : null}

      {showActions && rejecting ? (
        <View style={styles.rejectForm}>
          <Text style={styles.rejectFormLabel}>Reason (optional)</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="Why is this being rejected?"
            placeholderTextColor="#7a7060"
            style={styles.rejectInput}
            multiline
            numberOfLines={2}
            maxLength={300}
          />
          <View style={styles.actionRow}>
            <Pressable
              onPress={onCancelReject}
              style={[styles.actionBtn, styles.cancelBtn]}
              hitSlop={4}
            >
              <Text style={[styles.actionLabel, { color: "#0a1124" }]}>
                Cancel
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirmReject(note)}
              style={[styles.actionBtn, styles.rejectConfirmBtn]}
              hitSlop={4}
            >
              <Feather name="x" size={14} color="#f5ebd6" />
              <Text style={[styles.actionLabel, { color: "#f5ebd6" }]}>
                Confirm reject
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function StatusPill({ status }: { status: DeleteRequestRow["status"] }) {
  const map: Record<DeleteRequestRow["status"], { bg: string; fg: string; label: string }> = {
    pending: { bg: "rgba(197,133,58,0.18)", fg: "#8a5821", label: "Pending" },
    approved: { bg: "#d2e6e7", fg: "#1c6a73", label: "Approved" },
    rejected: { bg: "#f6dccd", fg: "#a8341f", label: "Rejected" },
    obsolete: { bg: "#efe5d0", fg: "#7a7060", label: "Obsolete" },
  };
  const style = map[status];
  return (
    <View style={[styles.pill, { backgroundColor: style.bg }]}>
      <Text style={[styles.pillText, { color: style.fg }]}>{style.label}</Text>
    </View>
  );
}

/* ──────────────────── Activity tab ──────────────────── */

function ActivityTab({
  rows,
  hasMore,
  loadingMore,
  onLoadMore,
  onOpenBoard,
  onOpenLedger,
}: {
  rows: ActivityHistoryRow[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpenBoard: (boardId: string) => void;
  onOpenLedger: () => void;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="activity"
        title="Nothing yet."
        body="Activity from cases, clients, workflow boards and chat will show up here as it happens."
      />
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {rows.map((row) => (
        <Pressable
          key={row.id}
          onPress={
            row.boardId ? () => onOpenBoard(row.boardId as string) : undefined
          }
          style={({ pressed }) => [
            styles.activityRow,
            row.boardId && pressed ? { opacity: 0.7 } : null,
          ]}
        >
          <View style={[styles.avatar, styles.avatarSmall]}>
            <Text style={[styles.avatarText, { fontSize: 11 }]}>
              {initialsOf(row.actorName)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.activityActor} numberOfLines={1}>
              {row.actorName}
            </Text>
            <Text style={styles.activityMessage} numberOfLines={3}>
              {stripBoldMarkup(row.message)}
            </Text>
            <Text style={styles.activityMeta}>{timeAgo(row.createdAt)}</Text>
          </View>
          {row.boardId ? (
            <Feather name="chevron-right" size={14} color="#8a5821" />
          ) : null}
        </Pressable>
      ))}

      {hasMore ? (
        <Pressable
          onPress={onLoadMore}
          disabled={loadingMore}
          style={styles.loadMore}
          accessibilityRole="button"
          accessibilityLabel="Load older activity"
        >
          {loadingMore ? (
            <ActivityIndicator size="small" color="#8a5821" />
          ) : (
            <Feather name="chevron-down" size={14} color="#8a5821" />
          )}
          <Text style={styles.loadMoreText}>
            {loadingMore ? "Loading…" : "Load older"}
          </Text>
        </Pressable>
      ) : (
        <Text style={styles.ledgerEnd}>
          That&rsquo;s the whole ledger the office is keeping.
        </Text>
      )}

      {/* The full feed has date ranges, an area filter and search. This
          drawer is the glance; that screen is the record. */}
      <Pressable
        onPress={onOpenLedger}
        style={styles.ledgerLink}
        accessibilityRole="button"
        accessibilityLabel="Open Office Activity"
      >
        <Text style={styles.ledgerLinkText}>See the full ledger</Text>
        <Feather name="arrow-right" size={13} color="#8a5821" />
      </Pressable>
    </View>
  );
}

/* ──────────────────── Shared bits ──────────────────── */

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={20} color="#8a5821" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? "";
  return (a + b).toUpperCase() || "·";
}

// Server messages use **bold** markup for hot tokens. The web's
// ActivityRow renders them as actual bold runs; here we strip them so
// the line reads cleanly. Bold rendering can come later if it adds
// value — the message itself is already specific enough without it.
function stripBoldMarkup(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "$1");
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  });
}

/* ──────────────────── Styles ──────────────────── */

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  tabButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(10,17,36,0.05)",
  },
  tabButtonActive: {
    backgroundColor: "#0a1124",
  },
  tabLabel: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 12,
    color: "#0a1124",
    letterSpacing: 0.2,
  },
  tabLabelActive: {
    color: "#f5ebd6",
  },
  tabBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: 9,
    backgroundColor: "#c5853a",
    alignItems: "center",
    justifyContent: "center",
  },
  tabBadgeActive: {
    backgroundColor: "#ddb074",
  },
  tabBadgeText: {
    fontFamily: "DMMono-Medium",
    fontSize: 9,
    color: "#2a1c08",
    letterSpacing: 0.4,
  },
  tabBadgeTextActive: {
    color: "#2a1c08",
  },
  errorBanner: {
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f6dccd",
    borderWidth: 1,
    borderColor: "#c14a37",
  },
  errorText: {
    fontFamily: "Manrope",
    fontSize: 12,
    color: "#0a1124",
  },
  scrollBody: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
  },
  center: {
    paddingVertical: 36,
    alignItems: "center",
  },
  requestCard: {
    backgroundColor: "#ffffff",
    borderRadius: 14,
    padding: 14,
    shadowColor: "#0a1124",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  requestHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  avatar: {
    height: 32,
    width: 32,
    borderRadius: 16,
    backgroundColor: "#0a1124",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmall: {
    height: 28,
    width: 28,
    borderRadius: 14,
  },
  avatarText: {
    fontFamily: "Crimson-SemiBold",
    fontSize: 12,
    color: "#ddb074",
  },
  requestActor: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 14,
    color: "#0a1124",
  },
  requestMeta: {
    fontFamily: "DMMono",
    fontSize: 10,
    color: "#7a7060",
    letterSpacing: 0.4,
    marginTop: 2,
  },
  requestBody: {
    fontFamily: "Manrope",
    fontSize: 13,
    color: "#0a1124",
    marginTop: 10,
    lineHeight: 18,
  },
  requestTarget: {
    fontFamily: "Manrope-SemiBold",
    color: "#0a1124",
  },
  reasonBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#efe5d0",
  },
  reasonLabel: {
    fontFamily: "DMMono-Medium",
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#8a5821",
  },
  reasonText: {
    fontFamily: "Crimson-Italic",
    fontSize: 13,
    color: "#0a1124",
    marginTop: 4,
    lineHeight: 18,
  },
  reviewerLine: {
    fontFamily: "Manrope",
    fontSize: 11,
    color: "#7a7060",
    marginTop: 8,
    fontStyle: "italic",
  },
  actionRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  approveBtn: {
    backgroundColor: "#0a1124",
  },
  rejectBtn: {
    backgroundColor: "rgba(10,17,36,0.06)",
  },
  cancelBtn: {
    backgroundColor: "rgba(10,17,36,0.06)",
  },
  rejectConfirmBtn: {
    backgroundColor: "#c14a37",
  },
  actionLabel: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 12,
    letterSpacing: 0.2,
  },
  rejectForm: {
    marginTop: 12,
  },
  rejectFormLabel: {
    fontFamily: "DMMono-Medium",
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#8a5821",
    marginBottom: 6,
  },
  rejectInput: {
    backgroundColor: "#f4ede0",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: "Manrope",
    fontSize: 13,
    color: "#0a1124",
    minHeight: 56,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "#e3d9c0",
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  pillText: {
    fontFamily: "DMMono-Medium",
    fontSize: 9,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  activityActor: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 13,
    color: "#0a1124",
  },
  activityMessage: {
    fontFamily: "Manrope",
    fontSize: 12,
    color: "#0a1124",
    marginTop: 2,
    lineHeight: 17,
  },
  activityMeta: {
    fontFamily: "DMMono",
    fontSize: 10,
    color: "#7a7060",
    letterSpacing: 0.4,
    marginTop: 3,
  },
  loadMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 11,
    borderRadius: 10,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e3d9c0",
  },
  loadMoreText: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 12.5,
    color: "#8a5821",
  },
  ledgerEnd: {
    fontFamily: "Manrope",
    fontSize: 11.5,
    color: "#a89c80",
    textAlign: "center",
    marginTop: 10,
  },
  ledgerLink: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 6,
    paddingVertical: 10,
  },
  ledgerLinkText: {
    fontFamily: "Manrope-SemiBold",
    fontSize: 12.5,
    color: "#8a5821",
  },
  empty: {
    paddingVertical: 36,
    alignItems: "center",
    paddingHorizontal: 16,
  },
  emptyIcon: {
    height: 48,
    width: 48,
    borderRadius: 24,
    backgroundColor: "#efe5d0",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontFamily: "Crimson-SemiBold",
    fontSize: 17,
    color: "#0a1124",
    marginTop: 12,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: "Manrope",
    fontSize: 12,
    color: "#7a7060",
    marginTop: 6,
    textAlign: "center",
    lineHeight: 17,
    maxWidth: 280,
  },
});
