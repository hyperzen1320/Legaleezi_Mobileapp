import { type RefObject } from "react";
import { PixelRatio, type View } from "react-native";
import { captureRef } from "react-native-view-shot";
import * as Print from "expo-print";
import { File } from "expo-file-system";

// Native equivalent of the web board's html-to-image + jsPDF export:
// capture the dedicated full-content BoardSnapshotView (never the live,
// scroll-clipped canvas), cap the output at a safe pixel budget, and for
// PDF embed the PNG into an A4 page with the same 28pt margins and
// auto-orientation the web export uses.

// Android software-bitmap / GL-texture ceiling; also the memory cap —
// 4096² @ 4B ≈ 64 MB transient, the safe upper bound.
const MAX_PIXELS = 4096;

export type BoardPng = { uri: string; outW: number; outH: number };

/** Capture the snapshot view (content-sized, unclipped) as a PNG file.
 *  contentW/H are the view's laid-out size in dp. */
export async function captureBoardPng(
  ref: RefObject<View | null>,
  contentW: number,
  contentH: number
): Promise<BoardPng> {
  const pr = PixelRatio.get();
  const rawW = contentW * pr;
  const rawH = contentH * pr;
  const scale = Math.min(1, MAX_PIXELS / rawW, MAX_PIXELS / rawH);
  const outW = Math.max(1, Math.round(rawW * scale));
  const outH = Math.max(1, Math.round(rawH * scale));

  const uri = await captureRef(ref, {
    format: "png",
    quality: 1,
    result: "tmpfile",
    // width/height resize the OUTPUT image (pixels) — this is the cap.
    ...(scale < 1 ? { width: outW, height: outH } : {}),
  });
  return { uri, outW, outH };
}

/** Wrap a captured PNG into an A4 PDF (28pt margins, orientation by
 *  aspect ratio, small title line) — mirrors the web's jsPDF export. */
export async function boardPngToPdf(
  png: BoardPng,
  boardTitle: string
): Promise<string> {
  const b64 = await new File(png.uri).base64();
  const landscape = png.outW >= png.outH;
  // A4 in points.
  const pageW = landscape ? 842 : 595;
  const pageH = landscape ? 595 : 842;
  const margin = 28;
  const headerH = 16;
  const availW = pageW - margin * 2;
  const availH = pageH - margin * 2 - headerH;
  const fit = Math.min(availW / png.outW, availH / png.outH, 1_000);
  const w = Math.max(1, Math.floor(png.outW * fit));
  const h = Math.max(1, Math.floor(png.outH * fit));
  const dateStr = new Date().toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: ${margin}pt; }
  .hd { font-family: -apple-system, Helvetica, sans-serif; font-size: 8pt;
        letter-spacing: 1px; text-transform: uppercase; color: #8a5821;
        margin: 0 0 6pt 0; }
  img { width: ${w}pt; height: ${h}pt; display: block; }
</style></head><body>
  <p class="hd">${escapeHtml(boardTitle)} · ${dateStr} · Legaleezi Work Flow</p>
  <img src="data:image/png;base64,${b64}" />
</body></html>`;

  const res = await Print.printToFileAsync({
    html,
    width: pageW,
    height: pageH,
    base64: false,
  });
  return res.uri;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
