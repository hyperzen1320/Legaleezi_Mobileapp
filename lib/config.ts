import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Resolves the Legaleezi backend base URL.
 *
 * Priority:
 *  1. EXPO_PUBLIC_API_URL env var (production / staging)
 *  2. Expo dev server's host (your laptop's LAN IP) — works for physical
 *     devices via Expo Go and for the LAN tunnel.
 *  3. Platform-specific local fallbacks (Android emulator special-cases
 *     localhost as 10.0.2.2; iOS simulator can use localhost).
 *  4. Plain http://localhost:3000.
 */
export function getApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && envUrl.trim().length > 0) return envUrl.replace(/\/$/, "");

  // Expo's manifest exposes the dev URI like "192.168.1.5:8081"
  const hostUri =
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants as unknown as {
      manifest2?: { extra?: { expoGo?: { developer?: { host?: string } } } };
    }).manifest2?.extra?.expoGo?.developer?.host;

  if (hostUri) {
    const host = hostUri.split(":")[0];
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      return `http://${host}:3000`;
    }
  }

  if (Platform.OS === "android") {
    // Android emulator alias for the host machine's localhost.
    return "http://10.0.2.2:3000";
  }

  return "http://localhost:3000";
}
