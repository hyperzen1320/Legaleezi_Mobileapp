import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { partnerChatUnread } from "./api";
import { reportBadgePart } from "./push";

// Singleton subscribable for chat unread counts — same pattern as
// notification-count.ts (one poll no matter how many observers,
// AppState-aware pause/resume, stale-response guard). Cadence matches
// the web sidebar's Senior Desk badge: 12s.

const POLL_INTERVAL_MS = 12_000;

export type ChatUnread = {
  totalUnread: number;
  groupUnread: number;
  privateUnread: number;
  byRoomId: Record<string, number>;
};

const ZERO: ChatUnread = {
  totalUnread: 0,
  groupUnread: 0,
  privateUnread: 0,
  byRoomId: {},
};

let current: ChatUnread = ZERO;
const subscribers = new Set<(c: ChatUnread) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
let inFlight = 0;

async function tick(): Promise<void> {
  const myReq = ++inFlight;
  try {
    const res = await partnerChatUnread();
    if (myReq !== inFlight) return;
    current = res;
    // Keep the OS badge — and so the launcher dot — in step with the
    // number the app itself is showing.
    reportBadgePart("chat", res.totalUnread);
    subscribers.forEach((cb) => cb(current));
  } catch {
    // Badge isn't critical — silence beats an unactionable toast.
  }
}

function startPolling(): void {
  if (timer !== null) return;
  tick();
  timer = setInterval(tick, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}

function handleAppState(state: AppStateStatus): void {
  if (state === "active") {
    if (subscribers.size > 0) startPolling();
  } else {
    stopPolling();
  }
}

function ensureSubscribed(): void {
  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", handleAppState);
  }
  if (AppState.currentState === "active") startPolling();
}

function maybeTeardown(): void {
  if (subscribers.size > 0) return;
  stopPolling();
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
}

/** Sign-out: forget this office's counts, and drop any poll still in
 *  flight, so the next person on the handset never sees them — not even
 *  for the moment before their own first poll lands. */
export function resetChatUnread(): void {
  inFlight++;
  current = ZERO;
  subscribers.forEach((cb) => cb(current));
}

/** Subscribe to office chat unread counts; `refresh` forces a re-poll
 *  (call after marking a room read so badges catch up instantly). */
export function useChatUnread(): { unread: ChatUnread; refresh: () => void } {
  const [unread, setUnread] = useState<ChatUnread>(current);
  useEffect(() => {
    subscribers.add(setUnread);
    ensureSubscribed();
    setUnread(current);
    return () => {
      subscribers.delete(setUnread);
      maybeTeardown();
    };
  }, []);
  return { unread, refresh: tick };
}
