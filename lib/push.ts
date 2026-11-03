import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { router } from "expo-router";
import {
  partnerRegisterPushToken,
  partnerRevokePushToken,
} from "./api";

// Push notifications — the reason the Legaleezi icon can carry a dot on
// the home screen while the app is closed.
//
// Android only draws that dot for a notification the system has actually
// posted, and only the OS can post one for an app that isn't running.
// So the in-app bell count, however accurate, could never do it: this is
// the only route there.
//
// Everything here degrades quietly. Expo Go can't get a project-scoped
// token, an emulator has no push service, and a user may decline the
// permission — in each case the app carries on with the in-app badges it
// always had and simply doesn't register an address.

// Foreground behaviour: still post the notification. Someone reading the
// Case Vault should see a Senior Desk message arrive, and posting is
// also what keeps the launcher dot in step with the tray.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

/** Kept in step with the `channelId` lib/push.ts sends from the server. */
const CHANNEL_ID = "default";

/** The EAS project the token is scoped to — see app.json's extra.eas. */
function projectId(): string | null {
  const fromExtra = Constants.expoConfig?.extra?.eas?.projectId;
  return typeof fromExtra === "string" && fromExtra ? fromExtra : null;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: "Chambers",
    importance: Notifications.AndroidImportance.HIGH,
    // showBadge is what permits the launcher dot on this channel.
    showBadge: true,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#c5853a",
  });
}

/**
 * Ask (once) and return this device's Expo push token, or null if the
 * device can't have one. Never throws — a phone without notifications is
 * a phone that still works.
 */
export async function getPushToken(): Promise<string | null> {
  try {
    // A simulator has no push service; asking produces an error dialog on
    // iOS and nothing useful anywhere.
    if (!Device.isDevice) return null;

    await ensureAndroidChannel();

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    // Only ask if we haven't been answered. Re-asking a user who said no
    // does nothing on Android 13+ and is rude besides.
    if (status !== "granted") {
      const asked = await Notifications.requestPermissionsAsync();
      status = asked.status;
    }
    if (status !== "granted") return null;

    const id = projectId();
    if (!id) return null;

    const res = await Notifications.getExpoPushTokenAsync({ projectId: id });
    return res.data || null;
  } catch {
    // Expo Go without a project, no network, no Google Play services —
    // all of them mean "no push here", none of them mean "fail".
    return null;
  }
}

/** Register this device against the signed-in advocate. */
export async function registerPushToken(): Promise<string | null> {
  const token = await getPushToken();
  if (!token) return null;
  try {
    await partnerRegisterPushToken({
      token,
      platform: Platform.OS === "ios" ? "ios" : "android",
      deviceName: Device.deviceName || Device.modelName || "",
    });
    return token;
  } catch {
    // The badge still works; the dot just won't. Not worth a toast.
    return null;
  }
}

/**
 * Hand the address back on sign-out. A shared office phone that kept a
 * signed-out advocate's token would keep showing their chambers'
 * notifications to whoever picked it up next.
 */
export async function revokePushToken(token: string | null): Promise<void> {
  if (!token) return;
  try {
    await partnerRevokePushToken(token);
  } catch {
    /* server-side pruning catches the rest */
  }
}

/** Mirror a count onto the OS badge. iOS draws the number; Android uses
 *  it to decide the dot on launchers that support one. */
async function setBadgeCount(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    /* unsupported launcher — nothing to do */
  }
}

// The OS badge is a single number, but two independent pollers feed it:
// unread chat and pending delete requests. Each reports its own part and
// this sums them, so neither can stamp over the other's contribution with
// its own — which is what would happen if both called setBadgeCount.
const badgeParts: Record<string, number> = {};

export function reportBadgePart(
  key: "chat" | "requests",
  count: number
): void {
  if (badgeParts[key] === count) return;
  badgeParts[key] = count;
  const total = Object.values(badgeParts).reduce((sum, n) => sum + n, 0);
  void setBadgeCount(total);
}

/** Sign-out: the next advocate on this handset starts from zero. */
export function resetBadge(): void {
  for (const key of Object.keys(badgeParts)) delete badgeParts[key];
  void setBadgeCount(0);
}

/**
 * Route a tapped notification to the thing it's about. Mounted once, at
 * the root, so it works whether the tap woke the app from cold or the
 * app was already open.
 */
export function useNotificationRouting(): void {
  const handledCold = useRef(false);

  useEffect(() => {
    const open = (data: Record<string, unknown> | undefined) => {
      if (!data) return;
      // The room id becomes part of a route, so only a plain id is
      // accepted — a crafted payload can't steer the app to another screen.
      if (
        data.kind === "chat" &&
        typeof data.roomId === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(data.roomId)
      ) {
        router.push(`/(home)/senior-desk/${data.roomId}` as never);
        return;
      }
      if (data.kind === "delete_request") {
        router.push("/(home)/delete-requests" as never);
      }
    };

    // Cold start: the tap that launched the app.
    if (!handledCold.current) {
      handledCold.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then((res) => {
          if (res) {
            open(
              res.notification.request.content.data as
                | Record<string, unknown>
                | undefined
            );
          }
        })
        .catch(() => undefined);
    }

    const sub = Notifications.addNotificationResponseReceivedListener((res) => {
      open(
        res.notification.request.content.data as
          | Record<string, unknown>
          | undefined
      );
    });
    return () => sub.remove();
  }, []);
}
