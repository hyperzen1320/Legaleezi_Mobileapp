import { downloadAuthorized, type DownloadedFile } from "./files";

// Request builders for the three server-generated exports. The server
// owns generation (exceljs/docx/pdfkit, shared with the web app) and the
// filename (Content-Disposition); fallback names here only cover the
// header going missing. Column keys and filter params mirror
// legaleasy/src/lib/case-export/types.ts and case-filter.ts — keep in
// lockstep with those files.

export type ExportFormat = "xlsx" | "docx" | "pdf";

export const EXPORT_FORMATS: {
  key: ExportFormat;
  label: string;
  hint: string;
  mime: string;
}[] = [
  {
    key: "xlsx",
    label: "Excel",
    hint: ".xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  {
    key: "docx",
    label: "Word",
    hint: ".docx",
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  { key: "pdf", label: "PDF", hint: ".pdf", mime: "application/pdf" },
];

export function mimeForFormat(format: ExportFormat): string {
  return EXPORT_FORMATS.find((f) => f.key === format)?.mime ?? "application/octet-stream";
}

/** Server-side case filters (case-filter.ts param names, all strings). */
export type CaseExportFilters = {
  scope?: "active" | "disposed";
  courtId?: string;
  courtPlace?: string;
  advocateId?: string;
  fromDate?: string;
  toDate?: string;
  search?: string;
  searchScope?: string;
};

export type ExportColumn = { key: string; label: string };

// Master column catalog — same keys/labels/order as the web export menu.
export const CASE_EXPORT_COLUMNS: ExportColumn[] = [
  { key: "sno", label: "S.No" },
  { key: "fileNo", label: "File No" },
  { key: "caseNo", label: "Case No" },
  { key: "iaNumbers", label: "IA No" },
  { key: "cnr", label: "CNR No" },
  { key: "clientName", label: "Client Name" },
  { key: "appearingFor", label: "Appearing For" },
  { key: "clientPhone", label: "Mobile 1" },
  { key: "clientWhatsapp", label: "Mobile 2" },
  { key: "courtName", label: "Court" },
  { key: "courtNumber", label: "Court No" },
  { key: "courtPlace", label: "Place" },
  { key: "status", label: "Status" },
  { key: "advocateName", label: "Advocate" },
  { key: "oppositeParty", label: "Opposite Party" },
  { key: "oppositeAdvocate", label: "Opp. Advocate" },
  { key: "lastHearingDate", label: "Prev Date" },
  { key: "nextHearingDate", label: "Next Date" },
  { key: "disposedAt", label: "Disposed On" },
];

export const CASE_EXPORT_DEFAULT_KEYS = [
  "sno",
  "fileNo",
  "caseNo",
  "iaNumbers",
  "cnr",
  "clientName",
  "appearingFor",
  "clientPhone",
  "clientWhatsapp",
  "courtName",
  "status",
  "lastHearingDate",
  "nextHearingDate",
];

export const DISPOSED_EXPORT_DEFAULT_KEYS = [
  "sno",
  "fileNo",
  "caseNo",
  "cnr",
  "clientName",
  "oppositeParty",
  "courtName",
  "courtPlace",
  "status",
  "disposedAt",
];

function dateSlug(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}${mm}${dd}`;
}

/** POST /api/app/cases/export — office-admin only (server-enforced). When
 *  `selectedIds` is non-empty the server exports exactly those rows and
 *  ignores the filter query (the Case Vault's "export selected" path). */
export async function exportCases(
  format: ExportFormat,
  opts?: {
    filters?: CaseExportFilters;
    columns?: string[] | null;
    selectedIds?: string[];
  }
): Promise<DownloadedFile> {
  const disposed = opts?.filters?.scope === "disposed";
  const hasSelection = Boolean(opts?.selectedIds && opts.selectedIds.length > 0);
  return downloadAuthorized("/api/app/cases/export", {
    method: "POST",
    body: {
      format,
      filters: opts?.filters ?? {},
      columns: opts?.columns ?? undefined,
      ...(hasSelection ? { selectedIds: opts!.selectedIds } : {}),
    },
    fallbackName: `${disposed ? "disposed-cases" : "case-report"}-${dateSlug()}.${format}`,
    mime: mimeForFormat(format),
  });
}

export type HearingExportBucket = "today" | "tomorrow" | "pending" | "all";

export const HEARING_EXPORT_BUCKETS: {
  key: HearingExportBucket;
  label: string;
}[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "pending", label: "Pending" },
  { key: "all", label: "All" },
];

/** GET /api/app/hearings/export — open to every member of the office. */
export async function exportHearings(
  format: ExportFormat,
  bucket: HearingExportBucket,
  q?: string
): Promise<DownloadedFile> {
  const qs = new URLSearchParams({ bucket, format });
  if (q && q.trim()) qs.set("q", q.trim());
  return downloadAuthorized(`/api/app/hearings/export?${qs.toString()}`, {
    method: "GET",
    fallbackName: `hearing-${bucket}-${dateSlug()}.${format}`,
    mime: mimeForFormat(format),
  });
}

/** GET /api/app/boards/[id]/export — xlsx is the only server format. */
export async function exportBoardXlsx(
  boardId: string,
  boardTitle: string
): Promise<DownloadedFile> {
  const slug =
    boardTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "board";
  return downloadAuthorized(`/api/app/boards/${boardId}/export?format=xlsx`, {
    method: "GET",
    fallbackName: `${slug}-board-${dateSlug()}.xlsx`,
    mime: mimeForFormat("xlsx"),
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
