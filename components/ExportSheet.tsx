import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Sheet from "./Sheet";
import {
  EXPORT_FORMATS,
  formatBytes,
  type ExportColumn,
  type ExportFormat,
} from "../lib/exports";
import { FileOpError, printFile, saveToDevice, shareFile } from "../lib/files";
import type { DownloadedFile } from "../lib/files";

// Shared export sheet — cases, disposed archive, hearings, boards all
// speak through this one component. The caller decides the formats on
// offer and what `run` actually hits; the sheet owns the configure →
// generating → ready flow and the share / save / print handoff.
//
// The disposed-archive export is office-admin gated on the server, and
// its caller hides the entry button for everyone else (the 403 message
// still surfaces here if something slips through). The Case Vault and
// hearing track exports are open to every member.

export type ExportSheetProps = {
  visible: boolean;
  onClose: () => void;
  eyebrow?: string;
  title: string;
  // Small mono line under the header — "Today · 14 matters", etc.
  contextLine?: string;
  formats?: ExportFormat[];
  // Optional column picker (cases exports). null/undefined hides it.
  columns?: { catalog: ExportColumn[]; defaultKeys: string[] } | null;
  // Extra controls rendered above the format row (e.g. bucket picker).
  children?: ReactNode;
  run: (
    format: ExportFormat,
    columnKeys: string[] | null
  ) => Promise<DownloadedFile>;
};

type Phase = "configure" | "working" | "done";

export default function ExportSheet({
  visible,
  onClose,
  eyebrow = "Export",
  title,
  contextLine,
  formats = ["xlsx", "docx", "pdf"],
  columns,
  children,
  run,
}: ExportSheetProps) {
  const offered = useMemo(
    () => EXPORT_FORMATS.filter((f) => formats.includes(f.key)),
    [formats]
  );
  const [format, setFormat] = useState<ExportFormat>(formats[0]);
  const [keys, setKeys] = useState<Set<string>>(
    () => new Set(columns?.defaultKeys ?? [])
  );
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("configure");
  const [file, setFile] = useState<DownloadedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  // Fresh configure state every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setFormat(formats[0]);
      setKeys(new Set(columns?.defaultKeys ?? []));
      setColumnsOpen(false);
      setPhase("configure");
      setFile(null);
      setError(null);
      setSavedNote(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function generate() {
    setPhase("working");
    setError(null);
    try {
      const out = await run(
        format,
        columns ? Array.from(keys) : null
      );
      setFile(out);
      setPhase("done");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      setPhase("configure");
      setError(err instanceof Error ? err.message : "Export failed. Try again.");
    }
  }

  async function handle(action: "share" | "save" | "print") {
    if (!file) return;
    setSavedNote(null);
    try {
      if (action === "share") {
        await shareFile(file.uri, file.mime, file.filename);
      } else if (action === "save") {
        const res = await saveToDevice(file.uri, file.filename, file.mime);
        if (res === "saved") setSavedNote("Saved to the chosen folder.");
      } else {
        await printFile(file.uri, file.mime);
      }
    } catch (err) {
      setError(
        err instanceof FileOpError || err instanceof Error
          ? err.message
          : "That didn't work. Try again."
      );
    }
  }

  const toggleKey = (key: string) => {
    setKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        // Keep at least one column selected — empty exports help nobody.
        if (next.size === 1) return prev;
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={phase === "working" ? () => {} : onClose}
      eyebrow={eyebrow}
      title={title}
      showClose={phase !== "working"}
      containerStyle={{ maxHeight: "86%" }}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14 }}
      >
        {contextLine ? (
          <Text
            className="text-[11px] text-app-fg-muted mb-3"
            style={{ fontFamily: "DMMono", letterSpacing: 0.6 }}
          >
            {contextLine}
          </Text>
        ) : null}

        {error ? (
          <View
            className="rounded-md px-3.5 py-2.5 mb-3 flex-row items-start gap-2"
            style={{ backgroundColor: "#f6dccd" }}
          >
            <Feather name="alert-triangle" size={14} color="#c14a37" />
            <Text
              className="flex-1 text-[12.5px] leading-[18px]"
              style={{ fontFamily: "Manrope", color: "#c14a37" }}
            >
              {error}
            </Text>
          </View>
        ) : null}

        {phase === "done" && file ? (
          <DoneView
            file={file}
            savedNote={savedNote}
            onShare={() => handle("share")}
            onSave={() => handle("save")}
            onPrint={file.mime === "application/pdf" ? () => handle("print") : null}
            onAgain={() => {
              setPhase("configure");
              setFile(null);
              setSavedNote(null);
            }}
            onClose={onClose}
          />
        ) : (
          <>
            {children}

            {/* Format chips — wax-seal toggles */}
            <Text
              className="text-[10px] uppercase text-app-copper-deep mb-2"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
            >
              Format
            </Text>
            <View className="flex-row gap-2.5">
              {offered.map((f) => {
                const active = f.key === format;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFormat(f.key)}
                    disabled={phase === "working"}
                    className="flex-1 items-center rounded-xl px-3 py-3 active:opacity-85"
                    style={{
                      backgroundColor: active ? "#c5853a" : "#ffffff",
                      borderWidth: 1.5,
                      borderColor: active ? "#8a5821" : "#e3d9c0",
                      shadowColor: "#0a1124",
                      shadowOpacity: active ? 0.18 : 0.04,
                      shadowRadius: active ? 8 : 4,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: active ? 3 : 1,
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                  >
                    <Text
                      className="text-[14px]"
                      style={{
                        fontFamily: "Crimson-SemiBold",
                        color: active ? "#2a1c08" : "#0a1124",
                      }}
                    >
                      {f.label}
                    </Text>
                    <Text
                      className="text-[9px] mt-0.5"
                      style={{
                        fontFamily: "DMMono",
                        letterSpacing: 1,
                        color: active ? "#2a1c08" : "#a89c80",
                      }}
                    >
                      {f.hint}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Optional column picker */}
            {columns ? (
              <View className="mt-5">
                <Pressable
                  onPress={() => setColumnsOpen((o) => !o)}
                  className="flex-row items-center justify-between active:opacity-60"
                  hitSlop={6}
                >
                  <Text
                    className="text-[10px] uppercase text-app-copper-deep"
                    style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
                  >
                    Columns · {keys.size}
                  </Text>
                  <View className="flex-row items-center gap-3">
                    <Pressable
                      onPress={() => setKeys(new Set(columns.defaultKeys))}
                      hitSlop={6}
                      className="active:opacity-50"
                    >
                      <Text
                        className="text-[10px] uppercase"
                        style={{
                          fontFamily: "DMMono",
                          letterSpacing: 1.2,
                          color: "#8a5821",
                        }}
                      >
                        Reset
                      </Text>
                    </Pressable>
                    <Feather
                      name={columnsOpen ? "chevron-up" : "chevron-down"}
                      size={15}
                      color="#8a5821"
                    />
                  </View>
                </Pressable>

                {columnsOpen ? (
                  <View
                    className="mt-2.5 rounded-xl bg-app-paper overflow-hidden"
                    style={{ borderWidth: 1, borderColor: "#e3d9c0" }}
                  >
                    {columns.catalog.map((col, i) => {
                      const on = keys.has(col.key);
                      return (
                        <Pressable
                          key={col.key}
                          onPress={() => toggleKey(col.key)}
                          className="flex-row items-center justify-between px-3.5 active:bg-app-paper-2"
                          style={{
                            minHeight: 44,
                            borderTopWidth: i === 0 ? 0 : 1,
                            borderTopColor: "#efe5d0",
                          }}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                        >
                          <Text
                            className="text-[13.5px]"
                            style={{
                              fontFamily: on ? "Manrope-SemiBold" : "Manrope",
                              color: on ? "#0a1124" : "#7a7060",
                            }}
                          >
                            {col.label}
                          </Text>
                          <Feather
                            name={on ? "check-square" : "square"}
                            size={16}
                            color={on ? "#8a5821" : "#c4baa3"}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Generate */}
            <Pressable
              onPress={generate}
              disabled={phase === "working"}
              className="mt-6 rounded-xl items-center justify-center flex-row gap-2 active:opacity-90"
              style={{
                backgroundColor: "#0a1124",
                paddingVertical: 14,
                opacity: phase === "working" ? 0.75 : 1,
                shadowColor: "#0a1124",
                shadowOpacity: 0.22,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 4,
              }}
              accessibilityRole="button"
              accessibilityLabel="Generate export"
            >
              {phase === "working" ? (
                <>
                  <ActivityIndicator size="small" color="#f5ebd6" />
                  <Text
                    className="text-[13.5px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
                  >
                    Preparing the file…
                  </Text>
                </>
              ) : (
                <>
                  <Feather name="download" size={15} color="#f5ebd6" />
                  <Text
                    className="text-[13.5px]"
                    style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
                  >
                    Generate {EXPORT_FORMATS.find((f) => f.key === format)?.label}
                  </Text>
                </>
              )}
            </Pressable>
            <View style={{ height: 16 }} />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

function DoneView({
  file,
  savedNote,
  onShare,
  onSave,
  onPrint,
  onAgain,
  onClose,
}: {
  file: DownloadedFile;
  savedNote: string | null;
  onShare: () => void;
  onSave: () => void;
  onPrint: (() => void) | null;
  onAgain: () => void;
  onClose: () => void;
}) {
  return (
    <View>
      {/* The fresh file, ledger-entry style */}
      <View
        className="rounded-xl bg-app-paper px-4 py-3.5 flex-row items-center gap-3"
        style={{
          borderWidth: 1,
          borderColor: "#e3d9c0",
          borderLeftWidth: 3,
          borderLeftColor: "#6c9858",
        }}
      >
        <View
          className="h-10 w-10 items-center justify-center rounded-lg"
          style={{ backgroundColor: "#efe5d0" }}
        >
          <Feather name="file-text" size={18} color="#8a5821" />
        </View>
        <View className="flex-1">
          <Text
            className="text-[13.5px] text-app-ink"
            style={{ fontFamily: "Manrope-SemiBold" }}
            numberOfLines={2}
          >
            {file.filename}
          </Text>
          <Text
            className="text-[10px] mt-0.5 text-app-fg-muted"
            style={{ fontFamily: "DMMono", letterSpacing: 0.6 }}
          >
            READY{file.size ? ` · ${formatBytes(file.size)}` : ""}
          </Text>
        </View>
        <Feather name="check-circle" size={18} color="#6c9858" />
      </View>

      {savedNote ? (
        <Text
          className="mt-2 text-[11px]"
          style={{ fontFamily: "DMMono", color: "#6c9858", letterSpacing: 0.4 }}
        >
          {savedNote}
        </Text>
      ) : null}

      <View className="mt-4 gap-2.5">
        <ActionRow icon="share-2" label="Share" onPress={onShare} primary />
        <ActionRow icon="folder" label="Save to device" onPress={onSave} />
        {onPrint ? (
          <ActionRow icon="printer" label="Print" onPress={onPrint} />
        ) : null}
      </View>

      <View className="mt-4 flex-row items-center justify-between">
        <Pressable onPress={onAgain} hitSlop={8} className="active:opacity-50">
          <Text
            className="text-[11px] uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.4,
              color: "#8a5821",
            }}
          >
            Export another
          </Text>
        </Pressable>
        <Pressable onPress={onClose} hitSlop={8} className="active:opacity-50">
          <Text
            className="text-[11px] uppercase"
            style={{
              fontFamily: "DMMono-Medium",
              letterSpacing: 1.4,
              color: "#7a7060",
            }}
          >
            Done
          </Text>
        </Pressable>
      </View>
      <View style={{ height: 16 }} />
    </View>
  );
}

export function ActionRow({
  icon,
  label,
  onPress,
  primary,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-4 active:opacity-85"
      style={{
        minHeight: 48,
        backgroundColor: primary ? "#c5853a" : "#ffffff",
        borderWidth: 1,
        borderColor: primary ? "#8a5821" : "#e3d9c0",
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather
        name={icon}
        size={16}
        color={primary ? "#2a1c08" : "#8a5821"}
      />
      <Text
        className="text-[14px]"
        style={{
          fontFamily: "Manrope-SemiBold",
          color: primary ? "#2a1c08" : "#0a1124",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
