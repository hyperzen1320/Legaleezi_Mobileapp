import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  PanResponder,
  Pressable,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { File } from "expo-file-system";
import {
  ImageManipulator,
  SaveFormat,
  type ImageManipulatorContext,
  type ImageResult,
} from "expo-image-manipulator";
import {
  MAX_DOC_BYTES,
  MAX_DOC_LABEL,
  splitName,
  type PickedFile,
} from "../../lib/files";

// Crop-and-rotate step for a photographed paper — straight after the
// camera, or from the pencil on a staged image. Full screen, dark, the
// photo fitted in the middle with a crop box whose corners drag to the
// edges of the page; the box itself drags to move it.
//
// The picker's own allowsEditing isn't used: on iOS it forces a square
// crop, which cuts most of an A4 order off.
//
// Coordinates: the photo is first decoded through the manipulator (which
// applies EXIF orientation), so the width/height the crop maths uses are
// the ones the manipulator will crop against. The final image is rendered
// from the original file in one pass — rotate, then crop — so a photo is
// re-encoded once, however many times the rotate buttons were pressed.

type Rect = { x: number; y: number; w: number; h: number };
type Bounds = { l: number; t: number; r: number; b: number };
type Handle = "tl" | "tr" | "bl" | "br" | "move";

// Room around the photo so corner handles at its edge stay inside the
// canvas — Android ignores touches outside a view's parent.
const PAD = 24;
const MIN_CROP = 48;
const HIT = 44;
const ARM = 22;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

function dragRect(
  kind: Handle,
  s: Rect,
  dx: number,
  dy: number,
  bd: Bounds
): Rect {
  const min = Math.min(MIN_CROP, bd.r - bd.l, bd.b - bd.t);
  let l = s.x;
  let t = s.y;
  let r = s.x + s.w;
  let b = s.y + s.h;
  if (kind === "move") {
    const mx = clamp(dx, bd.l - l, bd.r - r);
    const my = clamp(dy, bd.t - t, bd.b - b);
    return { x: l + mx, y: t + my, w: s.w, h: s.h };
  }
  if (kind === "tl" || kind === "bl") l = clamp(l + dx, bd.l, r - min);
  if (kind === "tr" || kind === "br") r = clamp(r + dx, l + min, bd.r);
  if (kind === "tl" || kind === "tr") t = clamp(t + dy, bd.t, b - min);
  if (kind === "bl" || kind === "br") b = clamp(b + dy, t + min, bd.b);
  return { x: l, y: t, w: r - l, h: b - t };
}

async function render(
  uri: string,
  edit: (c: ImageManipulatorContext) => ImageManipulatorContext = (c) => c,
  compress = 0.85
): Promise<ImageResult> {
  const context = ImageManipulator.manipulate(uri);
  try {
    const image = await edit(context).renderAsync();
    try {
      return await image.saveAsync({ compress, format: SaveFormat.JPEG });
    } finally {
      image.release();
    }
  } finally {
    context.release();
  }
}

export default function PhotoEditor({
  file,
  onCancel,
  onDone,
}: {
  // The staged photo to edit; null keeps the editor closed.
  file: PickedFile | null;
  onCancel: () => void;
  // Called with the edited photo, or with `file` itself when nothing was
  // changed — so "Use photo" never re-encodes an untouched picture.
  onDone: (edited: PickedFile) => void;
}) {
  const insets = useSafeAreaInsets();
  // `work` is what's on screen: the photo at the current rotation.
  const [work, setWork] = useState<ImageResult | null>(null);
  const [turns, setTurns] = useState(0);
  const [busy, setBusy] = useState<"load" | "rotate" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCropState] = useState<Rect | null>(null);

  // The PanResponders are built once, so they read live values from refs.
  const cropRef = useRef<Rect | null>(null);
  const startRef = useRef<Rect | null>(null);
  const boundsRef = useRef<Bounds | null>(null);
  const unrotated = useRef<ImageResult | null>(null);

  function setCrop(next: Rect | null) {
    cropRef.current = next;
    setCropState(next);
  }

  useEffect(() => {
    if (!file) return;
    let alive = true;
    unrotated.current = null;
    setWork(null);
    setTurns(0);
    setError(null);
    setCrop(null);
    setBusy("load");
    render(file.uri, undefined, 0.9)
      .then((r) => {
        if (!alive) return;
        unrotated.current = r;
        setWork(r);
      })
      .catch(() => {
        if (alive) setError("Couldn't open this photo for editing.");
      })
      .finally(() => {
        if (alive) setBusy(null);
      });
    return () => {
      alive = false;
    };
  }, [file]);

  // Where the photo sits in the canvas, fitted inside the padding.
  const fit = useMemo(() => {
    if (!work || !box) return null;
    const aw = box.w - PAD * 2;
    const ah = box.h - PAD * 2;
    if (aw <= 0 || ah <= 0) return null;
    const scale = Math.min(aw / work.width, ah / work.height);
    const w = work.width * scale;
    const h = work.height * scale;
    return { scale, x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  }, [work, box]);

  function resetCrop() {
    if (!fit) return;
    boundsRef.current = {
      l: fit.x,
      t: fit.y,
      r: fit.x + fit.w,
      b: fit.y + fit.h,
    };
    setCrop({ x: fit.x, y: fit.y, w: fit.w, h: fit.h });
  }

  // A new rotation or canvas size starts the crop over at the full photo.
  useEffect(resetCrop, [fit]);

  const responders = useMemo(() => {
    const make = (kind: Handle) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          startRef.current = cropRef.current;
        },
        onPanResponderMove: (_e, g) => {
          const start = startRef.current;
          const bounds = boundsRef.current;
          if (!start || !bounds) return;
          setCrop(dragRect(kind, start, g.dx, g.dy, bounds));
        },
      });
    return {
      tl: make("tl"),
      tr: make("tr"),
      bl: make("bl"),
      br: make("br"),
      move: make("move"),
    };
  }, []);

  async function rotate(dir: 1 | -1) {
    if (!file || !unrotated.current || busy) return;
    const next = (turns + dir + 4) % 4;
    setBusy("rotate");
    setError(null);
    try {
      const r =
        next === 0
          ? unrotated.current
          : await render(file.uri, (c) => c.rotate(next * 90), 0.9);
      setTurns(next);
      setWork(r);
    } catch {
      setError("Couldn't rotate the photo.");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    if (busy || !unrotated.current) return;
    setError(null);
    if (turns !== 0) {
      setTurns(0);
      setWork(unrotated.current);
    } else {
      resetCrop();
    }
  }

  async function done() {
    if (!file || busy) return;
    const c = cropRef.current;
    if (!work || !fit || !c) {
      // Couldn't load for editing — the photo still goes up as it was.
      onDone(file);
      return;
    }
    const full =
      c.x - fit.x < 1 &&
      c.y - fit.y < 1 &&
      fit.x + fit.w - (c.x + c.w) < 1 &&
      fit.y + fit.h - (c.y + c.h) < 1;
    if (turns === 0 && full) {
      onDone(file);
      return;
    }

    setBusy("save");
    setError(null);
    try {
      let rect: { originX: number; originY: number; width: number; height: number } | null =
        null;
      if (!full) {
        const originX = clamp(Math.round((c.x - fit.x) / fit.scale), 0, work.width - 1);
        const originY = clamp(Math.round((c.y - fit.y) / fit.scale), 0, work.height - 1);
        rect = {
          originX,
          originY,
          width: clamp(Math.round(c.w / fit.scale), 1, work.width - originX),
          height: clamp(Math.round(c.h / fit.scale), 1, work.height - originY),
        };
      }
      const result = await render(file.uri, (ctx) => {
        const rotated = turns ? ctx.rotate(turns * 90) : ctx;
        return rect ? rotated.crop(rect) : rotated;
      });
      const size = new File(result.uri).size || file.size;
      if (size > MAX_DOC_BYTES) {
        setError(`The edited photo is over ${MAX_DOC_LABEL}.`);
        return;
      }
      onDone({
        uri: result.uri,
        name: `${splitName(file.name).base}.jpg`,
        size,
        mimeType: "image/jpeg",
      });
    } catch {
      setError("Couldn't save the edited photo. Try again.");
    } finally {
      setBusy(null);
    }
  }

  function onCanvasLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    setBox((prev) =>
      prev && prev.w === width && prev.h === height
        ? prev
        : { w: width, h: height }
    );
  }

  const tools = !busy && Boolean(unrotated.current);

  return (
    <Modal
      visible={Boolean(file)}
      animationType="slide"
      onRequestClose={busy === "save" ? () => {} : onCancel}
      statusBarTranslucent
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "#0a1124",
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, 12),
        }}
      >
        {/* Top bar */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Pressable
            onPress={onCancel}
            disabled={busy === "save"}
            hitSlop={8}
            className="px-2 py-2 active:opacity-60"
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
          >
            <Text
              style={{ fontFamily: "Manrope-Medium", fontSize: 14, color: "#f5ebd6" }}
            >
              Cancel
            </Text>
          </Pressable>
          <View className="items-center">
            <Text
              className="text-[10px] uppercase"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8, color: "#ddb074" }}
            >
              Photo
            </Text>
            <Text
              style={{ fontFamily: "Crimson-SemiBold", fontSize: 18, color: "#f5ebd6" }}
            >
              Crop & rotate
            </Text>
          </View>
          <Pressable
            onPress={done}
            disabled={busy !== null}
            className="flex-row items-center gap-1.5 rounded-md px-3.5 py-2 active:opacity-80"
            style={{ backgroundColor: "#c5853a", opacity: busy ? 0.6 : 1 }}
            accessibilityRole="button"
            accessibilityLabel="Use photo"
          >
            {busy === "save" ? (
              <ActivityIndicator size="small" color="#2a1c08" />
            ) : (
              <Feather name="check" size={14} color="#2a1c08" />
            )}
            <Text
              style={{ fontFamily: "Manrope-SemiBold", fontSize: 13, color: "#2a1c08" }}
            >
              Use photo
            </Text>
          </Pressable>
        </View>

        {/* Canvas */}
        <View style={{ flex: 1 }} onLayout={onCanvasLayout}>
          {work && fit ? (
            <Image
              source={{ uri: work.uri }}
              style={{
                position: "absolute",
                left: fit.x,
                top: fit.y,
                width: fit.w,
                height: fit.h,
              }}
              resizeMode="stretch"
            />
          ) : null}

          {fit && crop && !busy ? (
            <>
              {/* Shade everything outside the crop */}
              <Shade left={fit.x} top={fit.y} width={fit.w} height={crop.y - fit.y} />
              <Shade
                left={fit.x}
                top={crop.y + crop.h}
                width={fit.w}
                height={fit.y + fit.h - (crop.y + crop.h)}
              />
              <Shade left={fit.x} top={crop.y} width={crop.x - fit.x} height={crop.h} />
              <Shade
                left={crop.x + crop.w}
                top={crop.y}
                width={fit.x + fit.w - (crop.x + crop.w)}
                height={crop.h}
              />

              <View
                {...responders.move.panHandlers}
                style={{
                  position: "absolute",
                  left: crop.x,
                  top: crop.y,
                  width: crop.w,
                  height: crop.h,
                  borderWidth: 1.5,
                  borderColor: "rgba(245,235,214,0.9)",
                }}
                accessibilityLabel="Crop area — drag to move"
              />

              <Corner kind="tl" x={crop.x} y={crop.y} handlers={responders.tl.panHandlers} />
              <Corner kind="tr" x={crop.x + crop.w} y={crop.y} handlers={responders.tr.panHandlers} />
              <Corner kind="bl" x={crop.x} y={crop.y + crop.h} handlers={responders.bl.panHandlers} />
              <Corner
                kind="br"
                x={crop.x + crop.w}
                y={crop.y + crop.h}
                handlers={responders.br.panHandlers}
              />
            </>
          ) : null}

          {busy === "load" || busy === "rotate" ? (
            <View
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: 0,
                bottom: 0,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ActivityIndicator size="large" color="#c5853a" />
            </View>
          ) : null}
        </View>

        {error ? (
          <View
            className="mx-5 mb-2 rounded-md px-3.5 py-2.5"
            style={{ backgroundColor: "#f6dccd" }}
          >
            <Text style={{ fontFamily: "Manrope", fontSize: 12.5, color: "#c14a37" }}>
              {error}
            </Text>
          </View>
        ) : null}

        <Text
          className="text-center"
          style={{
            fontFamily: "Manrope",
            fontSize: 12,
            color: "rgba(245,235,214,0.6)",
          }}
        >
          Drag the corners to the edges of the page.
        </Text>

        {/* Tools */}
        <View className="flex-row justify-center gap-3 px-5 pt-3 pb-1">
          <Tool icon="rotate-ccw" label="Rotate left" onPress={() => rotate(-1)} disabled={!tools} />
          <Tool icon="rotate-cw" label="Rotate right" onPress={() => rotate(1)} disabled={!tools} />
          <Tool icon="refresh-ccw" label="Reset" onPress={reset} disabled={!tools} />
        </View>
      </View>
    </Modal>
  );
}

function Shade(p: { left: number; top: number; width: number; height: number }) {
  if (p.width <= 0 || p.height <= 0) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: p.left,
        top: p.top,
        width: p.width,
        height: p.height,
        backgroundColor: "rgba(10,17,36,0.62)",
      }}
    />
  );
}

// A 44pt touch target centred on the corner, drawing an L along the two
// crop edges that meet there.
function Corner({
  kind,
  x,
  y,
  handlers,
}: {
  kind: "tl" | "tr" | "bl" | "br";
  x: number;
  y: number;
  handlers: object;
}) {
  const left = kind === "tl" || kind === "bl";
  const top = kind === "tl" || kind === "tr";
  return (
    <View
      {...handlers}
      style={{
        position: "absolute",
        left: x - HIT / 2,
        top: y - HIT / 2,
        width: HIT,
        height: HIT,
      }}
      accessibilityLabel="Crop corner — drag to resize"
    >
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: left ? HIT / 2 - 1.5 : HIT / 2 - ARM + 1.5,
          top: top ? HIT / 2 - 1.5 : HIT / 2 - ARM + 1.5,
          width: ARM,
          height: ARM,
          borderColor: "#ddb074",
          borderLeftWidth: left ? 3 : 0,
          borderRightWidth: left ? 0 : 3,
          borderTopWidth: top ? 3 : 0,
          borderBottomWidth: top ? 0 : 3,
        }}
      />
    </View>
  );
}

function Tool({
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
      className="flex-1 items-center rounded-xl py-2.5 active:opacity-70"
      style={{
        backgroundColor: "rgba(245,235,214,0.08)",
        opacity: disabled ? 0.45 : 1,
        maxWidth: 120,
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Feather name={icon} size={18} color="#f5ebd6" />
      <Text
        className="mt-1"
        style={{ fontFamily: "Manrope-Medium", fontSize: 11, color: "#f5ebd6" }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
