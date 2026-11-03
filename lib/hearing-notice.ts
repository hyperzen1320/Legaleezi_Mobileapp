import { Alert, Linking } from "react-native";
import { partnerGetNoticeTemplate } from "./api";
import { parseDateLocal, renderNotice } from "./notice-template";

// Sends a matter's hearing notice to the client on WhatsApp, worded by the
// office's template (the admin's My Profile → Pre-filled WhatsApp
// message). Every WhatsApp button that sends a notice — Case Vault and
// Hearing Track — goes through here, so they can't drift apart again.
//
// The template is fetched fresh on every send, so an edit the admin just
// made is what the next message says — not whatever the screen loaded
// when it first opened. If the fetch fails or hangs, the last copy this
// session fetched is used, then the built-in default.

export type NoticeMatter = {
  caseNo: string;
  fileNo: string;
  cnr: string;
  clientName: string;
  clientPhone: string;
  clientWhatsapp: string;
  oppositeParty: string;
  courtName: string;
  courtPlace: string;
  status: string;
  nextHearingDate: string | null;
  lastHearingDate: string | null;
};

const FETCH_TIMEOUT_MS = 4000;

let lastTemplate = "";
// Bumped on sign-out, so a fetch that was in flight for the previous
// office can't land in the cache after the next person signs in.
let session = 0;
// One send at a time — the fetch takes a beat, and a second tap in that
// beat would open WhatsApp twice.
let sending = false;

/** Sign-out: the template — office name and all — belongs to the office
 *  that was signed in. The next one must never fall back to it. */
export function resetNoticeCache(): void {
  session++;
  lastTemplate = "";
}

async function currentTemplate(): Promise<string> {
  const mine = session;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const { template } = await Promise.race([
      partnerGetNoticeTemplate(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timeout")),
          FETCH_TIMEOUT_MS
        );
      }),
    ]);
    if (mine === session) lastTemplate = template;
  } catch {
    /* keep the last copy */
  } finally {
    clearTimeout(timer);
  }
  // "" makes renderNotice use the built-in default.
  return mine === session ? lastTemplate : "";
}

export async function sendHearingNotice(
  m: NoticeMatter,
  officeName: string
): Promise<void> {
  const raw = (m.clientWhatsapp || m.clientPhone || "").replace(/\D/g, "");
  if (!raw || sending) return;
  const wa = raw.length === 10 ? `91${raw}` : raw;

  sending = true;
  try {
    const text = renderNotice(await currentTemplate(), {
      caseNo: m.caseNo || "",
      clientName: m.clientName || "",
      cnr: m.cnr || "",
      fileNo: m.fileNo || "",
      status: m.status || "",
      oppositeParty: m.oppositeParty || "",
      courtName: m.courtName || "",
      courtPlace: m.courtPlace || "",
      lastHearingDate: parseDateLocal(m.lastHearingDate),
      nextHearingDate: parseDateLocal(m.nextHearingDate),
      officeName: officeName || "",
    });

    const native = `whatsapp://send?phone=${wa}&text=${encodeURIComponent(text)}`;
    const fallback = `https://wa.me/${wa}?text=${encodeURIComponent(text)}`;
    try {
      const can = await Linking.canOpenURL(native);
      await Linking.openURL(can ? native : fallback);
    } catch {
      try {
        await Linking.openURL(fallback);
      } catch {
        Alert.alert("Couldn't open WhatsApp.");
      }
    }
  } finally {
    sending = false;
  }
}
