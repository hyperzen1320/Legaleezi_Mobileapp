import { File, Directory, Paths } from "expo-file-system";
// The ONE thing the SDK 54 object API doesn't do: hand Android a
// content:// URI. Needed to open a file for viewing (see openFile below).
import { getContentUriAsync } from "expo-file-system/legacy";
import { fetch as expoFetch } from "expo/fetch";
import * as IntentLauncher from "expo-intent-launcher";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { Platform } from "react-native";
import { getApiBaseUrl } from "./config";
import {
  apiUpload,
  getAuthHeader,
  notifyUnauthorized,
  type CaseDocumentDTO,
  type ChatAttachment,
} from "./api";

// The single front door for binary IO: authenticated downloads (exports,
// case documents), share/save/print, and the picker → multipart-upload
// pipeline. Server limits are mirrored from legaleasy/src/lib/case-docs.ts
// — if those change, change these together.
//
// expo-file-system here is the SDK 54 object API (File/Directory/Paths).
// The legacy API is used for exactly one call — getContentUriAsync, which
// the object API has no replacement for — and nothing else.

export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_DOC_LABEL = "25 MB";
export const MAX_FILES_PER_BATCH = 12;
export const ACCEPTED_EXT = [
  "pdf",
  "doc",
  "docx",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "heic",
  "heif",
] as const;

// Picker pre-filter only — the authoritative check (server-side and in
// validatePicked below) is by filename extension.
const ACCEPTED_MIME = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/*",
];

export const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  heif: "image/heif",
};

// iOS share-sheet hints. Without the right UTI, "Save to Files" offers a
// generic data blob and Quick Look refuses to preview.
const UTI_BY_MIME: Record<string, string> = {
  "application/pdf": "com.adobe.pdf",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "org.openxmlformats.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "org.openxmlformats.wordprocessingml.document",
  "application/msword": "com.microsoft.word.doc",
  "image/png": "public.png",
  "image/jpeg": "public.jpeg",
};

export type FileOpCode =
  | "cancelled"
  | "permission_denied"
  | "network"
  | "http"
  | "too_large"
  | "unsupported"
  | "no_app";

export class FileOpError extends Error {
  code: FileOpCode;
  status?: number;
  constructor(code: FileOpCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** "Order 12.pdf" → { base: "Order 12", ext: "pdf" }. A leading dot is part
 *  of the base, not an extension. */
export function splitName(name: string): { base: string; ext: string } {
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { base: name.slice(0, dot), ext: name.slice(dot + 1) }
    : { base: name, ext: "" };
}

/** A typed name made safe to use as a filename: characters no file system
 *  accepts become spaces, runs of spaces collapse, leading dots go. Empty
 *  when nothing usable is left — callers keep the old name then. */
export function cleanBaseName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
}

export function mimeFor(
  filename: string,
  fallback = "application/octet-stream"
): string {
  return MIME_BY_EXT[extOf(filename)] ?? fallback;
}

/**
 * RFC 6266/5987 Content-Disposition parser. Prefers the UTF-8 extended
 * form (`filename*=UTF-8''…`), falls back to the quoted/plain `filename=`
 * form, then to `fallback`. Handles the dual-form header the document
 * stream route emits and the simple form from the export routes.
 */
export function filenameFromContentDisposition(
  header: string | null,
  fallback: string
): string {
  if (!header) return fallback;
  const star = header.match(/filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/);
  if (star?.[1]) {
    try {
      const decoded = decodeURIComponent(star[1].trim());
      if (decoded) return sanitizeFilename(decoded);
    } catch {
      /* fall through to the plain form */
    }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/);
  const raw = (plain?.[1] ?? plain?.[2])?.trim();
  return raw ? sanitizeFilename(raw) : fallback;
}

function filenameFromUri(uri: string): string {
  const last = uri.split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

function sanitizeFilename(name: string): string {
  // Neutralise path separators and strip control characters a hostile
  // header could carry; keep everything else (spaces, dots, unicode).
  const clean = name
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f]/g, "")
    .trim();
  return clean || "download";
}

/* ─────────── Download cache ───────────
   Every download lands in its own unique dir under cache/legaleasy-dl so
   filenames never collide and partial files can be discarded wholesale.
   The whole root is swept once per launch — downloads are transient
   share-then-done artifacts, never long-lived state. */

const DL_ROOT = "legaleasy-dl";
let sweptThisLaunch = false;

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function freshDownloadDir(): Directory {
  const root = new Directory(Paths.cache, DL_ROOT);
  if (!sweptThisLaunch) {
    sweptThisLaunch = true;
    try {
      if (root.exists) root.delete();
    } catch {
      /* leftover lock on Android — per-download dirs still isolate us */
    }
  }
  const dir = new Directory(root, uid());
  dir.create({ intermediates: true });
  return dir;
}

/** Sign-out: delete every downloaded document now rather than at the
 *  next launch, and forget the Android save folder the last person
 *  picked — on a shared office phone, neither belongs to whoever signs
 *  in next. */
export function clearDownloads(): void {
  sessionSaveDir = null;
  try {
    const root = new Directory(Paths.cache, DL_ROOT);
    if (root.exists) root.delete();
  } catch {
    /* leftover lock on Android — the launch sweep catches it */
  }
}

function discard(dir: Directory): void {
  try {
    if (dir.exists) dir.delete();
  } catch {
    /* cache dir — the OS reclaims it eventually */
  }
}

export type DownloadedFile = {
  uri: string;
  filename: string;
  mime: string;
  size: number;
};

/**
 * Authenticated binary fetch into the app cache.
 *
 *  GET  → native streaming via File.downloadFileAsync (no JS buffering,
 *         safe for 25 MB documents); filename derived from response
 *         headers by the native side.
 *  POST → expo/fetch + bytes() → File.write (needed because the cases
 *         export endpoint takes a JSON body and returns binary);
 *         filename parsed from Content-Disposition.
 *
 * Throws FileOpError. Real HTTP 401s also flip the auth provider to
 * guest via notifyUnauthorized(), same as lib/api.ts.
 */
export async function downloadAuthorized(
  path: string,
  opts: {
    method?: "GET" | "POST";
    body?: unknown;
    fallbackName: string;
    mime?: string;
  }
): Promise<DownloadedFile> {
  const base = getApiBaseUrl();
  const url = `${base}${path}`;
  const auth = await getAuthHeader();
  const dir = freshDownloadDir();

  if ((opts.method ?? "GET") === "GET") {
    // The static returns the native base class (no `.name` getter), so
    // the filename comes from the uri the native side derived from the
    // response headers.
    let downloaded: Awaited<ReturnType<typeof File.downloadFileAsync>>;
    try {
      downloaded = await File.downloadFileAsync(url, dir, {
        headers: auth,
        idempotent: true,
      });
    } catch (err) {
      discard(dir);
      throw mapNativeDownloadError(err, base);
    }
    const filename = sanitizeFilename(
      filenameFromUri(downloaded.uri) || opts.fallbackName
    );
    return {
      uri: downloaded.uri,
      filename,
      mime:
        opts.mime ??
        mimeFor(filename, downloaded.type || "application/octet-stream"),
      size: downloaded.size,
    };
  }

  let res: Awaited<ReturnType<typeof expoFetch>>;
  try {
    res = await expoFetch(url, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        Accept: "*/*",
      },
      body: JSON.stringify(opts.body ?? {}),
    });
  } catch {
    discard(dir);
    throw new FileOpError(
      "network",
      `Couldn't reach the server at ${base}. Check your network.`
    );
  }

  if (!res.ok) {
    discard(dir);
    let message = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      /* body wasn't JSON */
    }
    if (res.status === 401) notifyUnauthorized();
    throw new FileOpError("http", message, res.status);
  }

  const bytes = await res.bytes();
  const filename = filenameFromContentDisposition(
    res.headers.get("content-disposition"),
    opts.fallbackName
  );
  const file = new File(dir, filename);
  file.write(bytes);
  return {
    uri: file.uri,
    filename,
    mime: opts.mime ?? res.headers.get("content-type") ?? mimeFor(filename),
    size: file.size,
  };
}

function mapNativeDownloadError(err: unknown, base: string): FileOpError {
  const msg = err instanceof Error ? err.message : String(err);
  // UnableToDownload messages include the HTTP status for non-2xx
  // responses; anything without one is a transport failure.
  const status = Number(msg.match(/\b([45]\d{2})\b/)?.[1]);
  if (Number.isFinite(status)) {
    if (status === 401) notifyUnauthorized();
    return new FileOpError("http", `Download failed (${status}).`, status);
  }
  return new FileOpError(
    "network",
    `Couldn't reach the server at ${base}. Check your network.`
  );
}

/* ─────────── View / share / save / print ─────────── */

/**
 * Opens a downloaded file for READING, without offering to send it
 * anywhere. This is the only file action a non-admin gets in the case
 * briefcase and in Senior Desk — they can read the paper, they can't
 * take it out of the office.
 *
 * Android hands the file to whatever app claims to view that MIME type
 * (ACTION_VIEW). It needs a content:// URI — Android's StrictMode throws
 * FileUriExposedException on a raw file:// — which is the one thing the
 * legacy FileSystem API still does that the SDK 54 object API doesn't,
 * hence the narrow legacy import here.
 *
 * iOS has no equivalent "view with" intent exposed to Expo; Quick Look
 * sits at the top of the share sheet, so that's the closest honest
 * equivalent there.
 */
export async function openFile(uri: string, mime: string): Promise<void> {
  if (Platform.OS === "android") {
    try {
      const contentUri = await getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync(
        "android.intent.action.VIEW",
        {
          data: contentUri,
          type: mime || "*/*",
          // FLAG_GRANT_READ_URI_PERMISSION — without it the receiving app
          // can't read the file we just handed it.
          flags: 1,
        }
      );
      return;
    } catch {
      // No app claims this type (or the intent bounced) — fall through to
      // the share sheet, which at least lists "Open with" targets.
    }
  }
  await shareFile(uri, mime);
}

export async function shareFile(
  uri: string,
  mime: string,
  dialogTitle?: string
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new FileOpError("no_app", "Sharing isn't available on this device.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: mime,
    dialogTitle,
    UTI: UTI_BY_MIME[mime],
  });
}

// Android keeps the SAF grant for the session so repeat saves skip the
// folder picker. iOS has no Downloads concept — "Save to Files" lives in
// the share sheet, so we route through it and report "shared".
// (The picker static returns the native base class, hence the alias.)
type SafDirectory = Awaited<ReturnType<typeof Directory.pickDirectoryAsync>>;
let sessionSaveDir: SafDirectory | null = null;

export async function saveToDevice(
  uri: string,
  filename: string,
  mime: string
): Promise<"saved" | "shared" | "cancelled"> {
  if (Platform.OS !== "android") {
    await shareFile(uri, mime, `Save ${filename}`);
    return "shared";
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    let dir: SafDirectory | null = sessionSaveDir;
    if (!dir) {
      try {
        dir = await Directory.pickDirectoryAsync();
      } catch {
        return "cancelled"; // picker dismissed
      }
      sessionSaveDir = dir;
    }
    try {
      const bytes = await new File(uri).bytes();
      const target = dir.createFile(filename, mime);
      target.write(bytes);
      return "saved";
    } catch {
      // Most likely a revoked/stale SAF grant from a previous pick —
      // drop the cached dir and re-prompt exactly once.
      sessionSaveDir = null;
    }
  }
  throw new FileOpError(
    "permission_denied",
    "Couldn't save to the chosen folder. Pick a different folder and try again."
  );
}

/** Print a PDF or image via the system print dialog. Other types aren't
 *  printable on-device — callers hide the action for them. */
export async function printFile(uri: string, mime: string): Promise<void> {
  if (mime === "application/pdf") {
    await printOrSwallowCancel({ uri });
    return;
  }
  if (mime.startsWith("image/")) {
    const b64 = await new File(uri).base64();
    const html = `<html><body style="margin:0"><img src="data:${mime};base64,${b64}" style="width:100%"/></body></html>`;
    await printOrSwallowCancel({ html });
    return;
  }
  throw new FileOpError(
    "unsupported",
    "Printing is available for PDF and image files."
  );
}

async function printOrSwallowCancel(
  options: Parameters<typeof Print.printAsync>[0]
): Promise<void> {
  try {
    await Print.printAsync(options);
  } catch (err) {
    // Dismissing the print dialog rejects on iOS — that's a user choice,
    // not a failure.
    const msg = err instanceof Error ? err.message.toLowerCase() : "";
    if (msg.includes("cancel") || msg.includes("did not complete")) return;
    throw err;
  }
}

/* ─────────── Pickers + upload ─────────── */

export type PickedFile = {
  uri: string;
  name: string;
  size: number;
  mimeType: string;
};

export type RejectedFile = {
  name: string;
  reason: "too_large" | "unsupported" | "empty" | "overflow";
};

export type PickResult = { ok: PickedFile[]; rejected: RejectedFile[] };

function validatePicked(files: PickedFile[], alreadyStaged = 0): PickResult {
  const ok: PickedFile[] = [];
  const rejected: RejectedFile[] = [];
  for (const f of files) {
    if (!(ACCEPTED_EXT as readonly string[]).includes(extOf(f.name))) {
      rejected.push({ name: f.name, reason: "unsupported" });
    } else if (f.size > MAX_DOC_BYTES) {
      rejected.push({ name: f.name, reason: "too_large" });
    } else if (f.size === 0) {
      rejected.push({ name: f.name, reason: "empty" });
    } else if (alreadyStaged + ok.length >= MAX_FILES_PER_BATCH) {
      rejected.push({ name: f.name, reason: "overflow" });
    } else {
      ok.push(f);
    }
  }
  return { ok, rejected };
}

/** System file picker. Returns null when the user cancels.
 *  `alreadyStaged` lets the attach sheet enforce the 12-file batch cap
 *  across multiple picks. */
export async function pickDocuments(
  alreadyStaged = 0
): Promise<PickResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    multiple: true,
    // REQUIRED on Android: gives a stable file:// copy we can hand to
    // FormData; content:// uris from the picker can expire mid-upload.
    copyToCacheDirectory: true,
    type: ACCEPTED_MIME,
  });
  if (res.canceled) return null;
  const files: PickedFile[] = res.assets.map((a) => ({
    uri: a.uri,
    name: a.name ?? `document-${uid()}`,
    size: a.size ?? 0,
    mimeType: a.mimeType ?? mimeFor(a.name ?? ""),
  }));
  return validatePicked(files, alreadyStaged);
}

/** Camera or photo-library source for image attachments (scans of orders,
 *  filings, etc.). Returns null when the user cancels. */
export async function pickImages(
  source: "camera" | "library",
  alreadyStaged = 0
): Promise<PickResult | null> {
  let result: ImagePicker.ImagePickerResult;
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      throw new FileOpError(
        "permission_denied",
        "Camera access is off. Enable it in Settings to scan documents."
      );
    }
    result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
  } else {
    result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_FILES_PER_BATCH,
      quality: 0.7,
    });
  }
  if (result.canceled) return null;

  const files: PickedFile[] = result.assets.map((a, i) => ({
    uri: a.uri,
    name: a.fileName ?? `photo-${uid()}-${i + 1}.jpg`,
    size: a.fileSize ?? 0,
    mimeType: a.mimeType ?? "image/jpeg",
  }));
  return validatePicked(files, alreadyStaged);
}

/**
 * Multipart upload to the case-documents endpoint. The server reads
 * form.getAll("files") and validates by filename extension, so every part
 * carries `name` with its extension intact. Partial success is a real
 * outcome: a 201 can still include per-file `errors`.
 */
export async function uploadCaseDocuments(
  caseId: string,
  files: PickedFile[]
): Promise<{ ok: true; documents: CaseDocumentDTO[]; errors: string[] }> {
  const form = new FormData();
  for (const f of files) {
    // React Native FormData file part — not a web Blob. The cast is the
    // standard RN idiom; fetch turns it into a multipart file section.
    form.append("files", {
      uri: f.uri,
      name: f.name,
      type: f.mimeType,
    } as unknown as Blob);
  }
  return apiUpload(`/api/app/cases/${caseId}/documents`, form);
}

/**
 * Multipart upload for Senior Desk chat attachments. Same picker → FormData
 * pipeline as case documents; the server reads form.getAll("files") and
 * returns ready-to-send attachment metadata (up to 6 files per request).
 */
export async function uploadChatAttachments(
  files: PickedFile[]
): Promise<{ ok: true; attachments: ChatAttachment[]; errors: string[] }> {
  const form = new FormData();
  for (const f of files) {
    form.append("files", {
      uri: f.uri,
      name: f.name,
      type: f.mimeType,
    } as unknown as Blob);
  }
  return apiUpload(`/api/app/chat/attachments`, form);
}

/** Pick a single .csv and return its text (for the case importer). Returns
 *  null when the user cancels. */
export async function pickCsvText(): Promise<{
  name: string;
  text: string;
} | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: [
      "text/csv",
      "text/comma-separated-values",
      "application/csv",
      "text/plain",
      "*/*",
    ],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (res.canceled) return null;
  const asset = res.assets[0];
  if (!asset) return null;
  const text = await new File(asset.uri).text();
  return { name: asset.name ?? "import.csv", text };
}
