import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import Sheet from "../Sheet";
import PhotoEditor from "./PhotoEditor";
import {
  FileOpError,
  MAX_DOC_LABEL,
  MAX_FILES_PER_BATCH,
  cleanBaseName,
  pickDocuments,
  pickImages,
  splitName,
  uploadCaseDocuments,
  type PickedFile,
  type RejectedFile,
} from "../../lib/files";
import { formatBytes } from "../../lib/exports";

// Staged-batch upload sheet for case documents. Sources: device files,
// photo library, camera (court orders photographed on the spot). The
// batch cap and per-file limits mirror the server exactly; rejected
// picks are listed with the reason instead of silently dropped. Upload
// is a single multipart POST — a 201 can still carry per-file errors
// (partial success), which stay on screen for a re-try.
//
// Before upload, any staged file can be renamed (the extension stays —
// the server decides what a file is by it), and any staged photo can be
// cropped and rotated. A photo fresh from the camera opens straight in
// the editor, since a phone shot of an order nearly always wants
// trimming to the page.

type Renaming = { uri: string; draft: string };

// The staged list with a pending rename applied. A name that cleans down
// to nothing keeps the file's old name; typing the extension as well
// ("order.pdf") doesn't double it.
function applyRename(files: PickedFile[], r: Renaming): PickedFile[] {
  return files.map((f) => {
    if (f.uri !== r.uri) return f;
    const { ext } = splitName(f.name);
    let typed = r.draft.trim();
    if (ext && typed.toLowerCase().endsWith(`.${ext.toLowerCase()}`)) {
      typed = typed.slice(0, -(ext.length + 1));
    }
    const base = cleanBaseName(typed);
    if (!base) return f;
    return { ...f, name: ext ? `${base}.${ext}` : base };
  });
}

const REJECT_LABEL: Record<RejectedFile["reason"], string> = {
  too_large: `over ${MAX_DOC_LABEL}`,
  unsupported: "type not accepted",
  empty: "empty file",
  overflow: `batch is full (${MAX_FILES_PER_BATCH} max)`,
};

export default function AttachDocumentsSheet({
  visible,
  initialSource = null,
  onClose,
  caseId,
  onUploaded,
}: {
  visible: boolean;
  // Where the Upload dropdown said the papers are coming from. The matching
  // picker fires as soon as the sheet opens, so choosing a source and then
  // choosing it again inside the sheet is not two steps.
  initialSource?: "files" | "library" | "camera" | null;
  onClose: () => void;
  caseId: string;
  onUploaded: () => void;
}) {
  const [staged, setStaged] = useState<PickedFile[]>([]);
  const [rejected, setRejected] = useState<RejectedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<Renaming | null>(null);
  const [editing, setEditing] = useState<PickedFile | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStaged([]);
    setRejected([]);
    setUploading(false);
    setServerErrors([]);
    setNote(null);
    setError(null);
    setRenaming(null);
    setEditing(null);
    if (initialSource) void pick(initialSource);
    // pick() is stable for this purpose and re-running on every render
    // would re-open the picker; the sheet opening is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialSource]);

  async function pick(source: "files" | "library" | "camera") {
    setError(null);
    setNote(null);
    try {
      const res =
        source === "files"
          ? await pickDocuments(staged.length)
          : await pickImages(
              source === "camera" ? "camera" : "library",
              staged.length
            );
      if (!res) return; // user cancelled
      setStaged((prev) => [...prev, ...res.ok]);
      setRejected(res.rejected);
      if (source === "camera" && res.ok.length === 1) {
        // iOS is still animating the camera away when the picker
        // resolves, and won't present the editor over it until it's gone.
        const shot = res.ok[0];
        setTimeout(() => setEditing(shot), Platform.OS === "ios" ? 450 : 0);
      }
    } catch (err) {
      if (err instanceof FileOpError && err.code === "permission_denied") {
        Alert.alert("Camera is off", err.message, [
          { text: "Not now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]);
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn't open the picker.");
    }
  }

  function remove(uri: string) {
    setStaged((prev) => prev.filter((f) => f.uri !== uri));
    if (renaming?.uri === uri) setRenaming(null);
  }

  function startRename(f: PickedFile) {
    // Commit a rename already open on another row rather than losing it.
    if (renaming && renaming.uri !== f.uri) {
      setStaged((prev) => applyRename(prev, renaming));
    }
    setRenaming({ uri: f.uri, draft: splitName(f.name).base });
  }

  function commitRename() {
    if (!renaming) return;
    setStaged((prev) => applyRename(prev, renaming));
    setRenaming(null);
  }

  function edited(from: PickedFile, to: PickedFile) {
    setStaged((prev) => prev.map((f) => (f.uri === from.uri ? to : f)));
    setEditing(null);
  }

  async function upload() {
    if (staged.length === 0 || uploading) return;
    // A name still being typed goes up as typed.
    const files = renaming ? applyRename(staged, renaming) : staged;
    setStaged(files);
    setRenaming(null);
    setUploading(true);
    setError(null);
    setServerErrors([]);
    try {
      const res = await uploadCaseDocuments(caseId, files);
      onUploaded();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (res.errors.length === 0) {
        onClose();
      } else {
        // Partial success: the uploaded ones are in; surface what failed
        // so the user can fix and re-attach just those.
        setStaged([]);
        setRejected([]);
        setServerErrors(res.errors);
        setNote(
          res.documents.length > 0
            ? `${res.documents.length} uploaded · ${res.errors.length} failed`
            : null
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  const room = MAX_FILES_PER_BATCH - staged.length;

  return (
    <Sheet
      visible={visible}
      onClose={uploading ? () => {} : onClose}
      eyebrow="Briefcase"
      title="Upload documents"
      showClose={!uploading}
      containerStyle={{ maxHeight: "88%" }}
    >
      <ScrollView
        style={{ flexShrink: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 14 }}
      >
        <Text
          className="text-[11px] text-app-fg-muted"
          style={{ fontFamily: "DMMono", letterSpacing: 0.5 }}
        >
          PDF · Word · images, up to {MAX_DOC_LABEL} each,{" "}
          {MAX_FILES_PER_BATCH} per batch
        </Text>

        {/* Sources */}
        <View className="flex-row gap-2.5 mt-3.5">
          <SourceButton
            icon="folder"
            label="Files"
            onPress={() => pick("files")}
            disabled={uploading || room <= 0}
          />
          <SourceButton
            icon="image"
            label="Photos"
            onPress={() => pick("library")}
            disabled={uploading || room <= 0}
          />
          <SourceButton
            icon="camera"
            label="Camera"
            onPress={() => pick("camera")}
            disabled={uploading || room <= 0}
          />
        </View>

        {error ? (
          <Banner tone="danger" text={error} />
        ) : null}
        {note ? <Banner tone="success" text={note} /> : null}

        {/* Server-side per-file failures (partial success) */}
        {serverErrors.length > 0 ? (
          <View
            className="mt-3 rounded-md px-3.5 py-2.5"
            style={{ backgroundColor: "#f6dccd" }}
          >
            {serverErrors.map((e, i) => (
              <Text
                key={i}
                className="text-[12px] leading-[18px]"
                style={{ fontFamily: "Manrope", color: "#c14a37" }}
              >
                · {e}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Rejected at pick time */}
        {rejected.length > 0 ? (
          <View
            className="mt-3 rounded-md px-3.5 py-2.5"
            style={{
              backgroundColor: "#efe5d0",
            }}
          >
            {rejected.map((r, i) => (
              <Text
                key={`${r.name}-${i}`}
                className="text-[12px] leading-[18px]"
                style={{ fontFamily: "Manrope", color: "#4d4538" }}
                numberOfLines={1}
              >
                · {r.name} — {REJECT_LABEL[r.reason]}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Staged batch */}
        {staged.length > 0 ? (
          <View
            className="mt-4 rounded-xl bg-app-paper overflow-hidden"
            style={{ borderWidth: 1, borderColor: "#e3d9c0" }}
          >
            {staged.map((f, i) => {
              const isImage = f.mimeType.startsWith("image/");
              const isRenaming = renaming?.uri === f.uri;
              const { ext } = splitName(f.name);
              return (
                <View
                  key={f.uri}
                  className="flex-row items-center gap-3 px-3.5"
                  style={{
                    minHeight: 52,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: "#efe5d0",
                  }}
                >
                  <Feather
                    name={
                      isImage
                        ? "image"
                        : f.mimeType === "application/pdf"
                          ? "file-text"
                          : "file"
                    }
                    size={15}
                    color="#8a5821"
                  />
                  {isRenaming ? (
                    <>
                      {/* The extension is shown but not editable — the
                          server decides what a file is by it. */}
                      <View
                        className="flex-1 min-w-0 flex-row items-center rounded-md"
                        style={{
                          borderWidth: 1,
                          borderColor: "#c5853a",
                          backgroundColor: "#ffffff",
                          paddingHorizontal: 8,
                        }}
                      >
                        <TextInput
                          value={renaming.draft}
                          onChangeText={(draft) =>
                            setRenaming({ uri: f.uri, draft })
                          }
                          onSubmitEditing={commitRename}
                          autoFocus
                          selectTextOnFocus
                          returnKeyType="done"
                          autoCapitalize="words"
                          autoCorrect={false}
                          maxLength={120}
                          placeholder="File name"
                          placeholderTextColor="#a89c80"
                          className="flex-1 text-[13px] text-app-ink"
                          style={{ fontFamily: "Manrope-SemiBold", paddingVertical: 7 }}
                          accessibilityLabel="New file name"
                        />
                        {ext ? (
                          <Text
                            className="text-[12px] text-app-fg-muted"
                            style={{ fontFamily: "DMMono" }}
                          >
                            .{ext}
                          </Text>
                        ) : null}
                      </View>
                      <Pressable
                        onPress={commitRename}
                        hitSlop={8}
                        className="h-8 w-8 items-center justify-center rounded-md active:opacity-70"
                        style={{ backgroundColor: "#0a1124" }}
                        accessibilityRole="button"
                        accessibilityLabel="Save name"
                      >
                        <Feather name="check" size={15} color="#f5ebd6" />
                      </Pressable>
                    </>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => startRename(f)}
                        disabled={uploading}
                        className="flex-1 min-w-0 active:opacity-60"
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${f.name}`}
                      >
                        <Text
                          className="text-[13px] text-app-ink"
                          style={{ fontFamily: "Manrope-SemiBold" }}
                          numberOfLines={1}
                        >
                          {f.name}
                        </Text>
                        <Text
                          className="text-[10px] text-app-fg-muted"
                          style={{ fontFamily: "DMMono", letterSpacing: 0.4 }}
                        >
                          {formatBytes(f.size)}
                        </Text>
                      </Pressable>
                      {!uploading ? (
                        <View className="flex-row items-center" style={{ gap: 14 }}>
                          {isImage ? (
                            <Pressable
                              onPress={() => {
                                commitRename();
                                setEditing(f);
                              }}
                              hitSlop={8}
                              className="active:opacity-50"
                              accessibilityLabel={`Crop or rotate ${f.name}`}
                            >
                              <Feather name="crop" size={15} color="#8a5821" />
                            </Pressable>
                          ) : null}
                          <Pressable
                            onPress={() => startRename(f)}
                            hitSlop={8}
                            className="active:opacity-50"
                            accessibilityLabel={`Rename ${f.name}`}
                          >
                            <Feather name="edit-2" size={14} color="#8a5821" />
                          </Pressable>
                          <Pressable
                            onPress={() => remove(f.uri)}
                            hitSlop={8}
                            className="active:opacity-50"
                            accessibilityLabel={`Remove ${f.name}`}
                          >
                            <Feather name="x" size={15} color="#7a7060" />
                          </Pressable>
                        </View>
                      ) : null}
                    </>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}

      </ScrollView>

      {/* Upload — pinned below the scroll area so it stays visible no matter
          how many files are staged (the list scrolls, the button doesn't). */}
      <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
        <Pressable
          onPress={upload}
          disabled={uploading || staged.length === 0}
          className="rounded-xl items-center justify-center flex-row gap-2 active:opacity-90"
          style={{
            backgroundColor: staged.length === 0 ? "#c4baa3" : "#0a1124",
            paddingVertical: 14,
            shadowColor: "#0a1124",
            shadowOpacity: staged.length === 0 ? 0 : 0.22,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: staged.length === 0 ? 0 : 4,
          }}
          accessibilityRole="button"
          accessibilityLabel="Upload documents"
        >
          {uploading ? (
            <>
              <ActivityIndicator size="small" color="#f5ebd6" />
              <Text
                className="text-[13.5px]"
                style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
              >
                Uploading {staged.length}…
              </Text>
            </>
          ) : (
            <>
              <Feather name="upload" size={15} color="#f5ebd6" />
              <Text
                className="text-[13.5px]"
                style={{ fontFamily: "Manrope-SemiBold", color: "#f5ebd6" }}
              >
                {staged.length === 0
                  ? "Pick something to attach"
                  : `Upload ${staged.length} ${staged.length === 1 ? "file" : "files"}`}
              </Text>
            </>
          )}
        </Pressable>
      </View>

      {/* Rendered inside the sheet: iOS only presents a second modal on
          top of one that's already showing when it's nested in it. */}
      <PhotoEditor
        file={editing}
        onCancel={() => setEditing(null)}
        onDone={(out) => editing && edited(editing, out)}
      />
    </Sheet>
  );
}

function SourceButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className="flex-1 items-center rounded-xl py-3.5 active:opacity-85"
      style={{
        backgroundColor: "#ffffff",
        borderWidth: 1.5,
        borderColor: "#e3d9c0",
        borderStyle: "dashed",
        opacity: disabled ? 0.45 : 1,
      }}
      accessibilityRole="button"
      accessibilityLabel={`Attach from ${label}`}
    >
      <Feather name={icon} size={17} color="#8a5821" />
      <Text
        className="mt-1.5 text-[12px]"
        style={{ fontFamily: "Manrope-SemiBold", color: "#0a1124" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Banner({ tone, text }: { tone: "danger" | "success"; text: string }) {
  const danger = tone === "danger";
  return (
    <View
      className="mt-3 rounded-md px-3.5 py-2.5 flex-row items-start gap-2"
      style={{ backgroundColor: danger ? "#f6dccd" : "rgba(108,152,88,0.14)" }}
    >
      <Feather
        name={danger ? "alert-triangle" : "check-circle"}
        size={14}
        color={danger ? "#c14a37" : "#6c9858"}
      />
      <Text
        className="flex-1 text-[12.5px] leading-[18px]"
        style={{
          fontFamily: "Manrope",
          color: danger ? "#c14a37" : "#3a5a40",
        }}
      >
        {text}
      </Text>
    </View>
  );
}
