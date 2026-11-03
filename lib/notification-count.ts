import { useEffect, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { partnerDeleteRequestCount } from "./api";
import { reportBadgePart } from "./push";

// Singleton subscribable for the bell badge count. Many components can
// observe the same count (home topbar, admin topbar, any future drawer
// item) without each running its own poll. When the last observer
// unmounts polling stops; when an observer re-mounts it resumes.
//
// AppState-aware: while the app is backgrounded we pause the timer so
// we don't burn battery on a number nobody can see. We also re-tick
// once on foreground so the badge is fresh by the time the bell is
// visible again.
//
// What this deliberately does NOT do:
//  - Push notifications. Those are PR-C work — the in-app bell is the
//    fallback when push isn't available (Expo Go, push-disabled, etc.).
//  - Per-tab counts. The number here is the pending delete-request
//    count only; chat unread + reminder due counts will join in their
//    own subscribables in PR-C.

const POLL_INTERVAL_MS = 30_000;

let currentCount = 0;
const subscribers = new Set<(count: number) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
// Track the in-flight request so a slow network response doesn't
// overwrite a newer one — e.g. an approve() that drops the count to 0
// shouldn't be undone by a stale GET that loaded just before.
let inFlight = 0;

async function tick(): Promise<void> {
  const myReq = ++inFlight;
  try {
    const res = await partnerDeleteRequestCount();
    if (myReq !== inFlight) return; // staler than the latest request
    if (res.count === currentCount) return; // no change, skip notifying
    currentCount = res.count;
    // Same number on the OS badge as on the bell.
    reportBadgePart("requests", currentCount);
    subscribers.forEach((cb) => cb(currentCount));
  } catch {
    // Bell badge isn't critical — staying silent is better than
    // popping an error toast users can't act on. If the network is
    // down, the next foreground tick will retry.
  }
}

function startPolling(): void {
  if (timer !== null) return;
  // Tick once immediately so observers don't wait the full interval
  // for the first read after foregrounding.
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

/** Sign-out: forget this office's count and drop any poll still in
 *  flight — the next person on the handset starts from zero. */
export function resetNotificationCount(): void {
  inFlight++;
  currentCount = 0;
  subscribers.forEach((cb) => cb(currentCount));
}

/**
 * Subscribe a component to the delete-request count. Returns the
 * current value plus an imperative refresh — useful after the caller
 * has just changed state on the server (approved a request, etc.) and
 * wants the badge to catch up without waiting for the next poll.
 */
export function useNotificationCount(): {
  count: number;
  refresh: () => void;
} {
  const [count, setCount] = useState(currentCount);
  useEffect(() => {
    subscribers.add(setCount);
    ensureSubscribed();
    // The current snapshot may already be different from what local
    // state has (e.g. the singleton was warmed by another screen
    // earlier). Sync immediately.
    setCount(currentCount);
    return () => {
      subscribers.delete(setCount);
      maybeTeardown();
    };
  }, []);
  return { count, refresh: tick };
}
