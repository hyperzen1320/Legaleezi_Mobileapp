import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Image,
  Modal,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import * as Sharing from "expo-sharing";
import {
  ApiError,
  getAuthHeader,
  partnerListTutorials,
  tutorialFileUrl,
  type TutorialMedia,
} from "../../lib/api";
import { downloadAuthorized } from "../../lib/files";

// Tutorials — videos / images / PDFs uploaded by the Legaleezi team (global
// admin). Videos play in-app via expo-video; images open full-screen; PDFs
// download and open in the system viewer. All fetch the binary with the
// bearer token (the endpoint is auth-gated + range-enabled for seeking).

const KIND_ICON: Record<TutorialMedia["kind"], keyof typeof Feather.glyphMap> = {
  video: "play",
  image: "image",
  pdf: "file-text",
};
const KIND_LABEL: Record<TutorialMedia["kind"], string> = {
  video: "Video",
  image: "Image",
  pdf: "PDF",
};

export default function Tutorials() {
  const router = useRouter();
  const [items, setItems] = useState<TutorialMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  const [video, setVideo] = useState<TutorialMedia | null>(null);
  const [image, setImage] = useState<TutorialMedia | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await partnerListTutorials();
      setItems(data.tutorials);
      setError(null);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Couldn't load tutorials."
      );
    }
  }, []);

  useEffect(() => {
    getAuthHeader().then(setAuthHeaders);
    (async () => {
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  async function openPdf(t: TutorialMedia) {
    setPdfBusy(t.id);
    try {
      const file = await downloadAuthorized(
        `/api/mobile/tutorials/${t.id}/file`,
        { fallbackName: `${t.title || "tutorial"}.pdf`, mime: "application/pdf" }
      );
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/pdf",
          dialogTitle: t.title,
        });
      }
    } catch (err) {
      Alert.alert(
        "Couldn't open",
        err instanceof ApiError ? err.message : "Please try again."
      );
    } finally {
      setPdfBusy(null);
    }
  }

  function onPress(t: TutorialMedia) {
    if (t.kind === "video") setVideo(t);
    else if (t.kind === "image") setImage(t);
    else void openPdf(t);
  }

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <View
          className="border-b border-app-edge bg-app-canvas px-4 py-3 flex-row items-center"
          style={{ gap: 10 }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            className="active:opacity-50 h-9 w-9 items-center justify-center rounded-md"
            style={{ backgroundColor: "#ffffff" }}
            accessibilityLabel="Back"
          >
            <Feather name="arrow-left" size={17} color="#0a1124" />
          </Pressable>
          <View>
            <Text
              className="text-[10px] uppercase text-app-copper-deep"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
            >
              Help &amp; Support
            </Text>
            <Text
              className="text-[18px] tracking-tight text-app-ink leading-none"
              style={{ fontFamily: "Crimson-SemiBold" }}
            >
              Tutorials
            </Text>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          <ScrollView
            contentContainerClassName="px-5 pt-5 pb-10"
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#c5853a"
              />
            }
          >
            {error ? (
              <View
                className="rounded-md px-4 py-3 mb-4"
                style={{ backgroundColor: "#f6dccd" }}
              >
                <Text
                  className="text-[13px]"
                  style={{ fontFamily: "Manrope", color: "#c14a37" }}
                >
                  {error}
                </Text>
              </View>
            ) : null}

            {items.length === 0 && !error ? (
              <View className="items-center pt-16 px-6">
                <View
                  className="h-16 w-16 items-center justify-center rounded-2xl"
                  style={{ backgroundColor: "#efe5d0" }}
                >
                  <Feather name="play-circle" size={26} color="#8a5821" />
                </View>
                <Text
                  className="mt-5 text-[20px] tracking-tight text-app-ink text-center"
                  style={{ fontFamily: "Crimson-SemiBold" }}
                >
                  No tutorials yet.
                </Text>
                <Text
                  className="mt-2 text-[13px] text-app-fg-muted text-center"
                  style={{ fontFamily: "Manrope", lineHeight: 20 }}
                >
                  Walkthrough videos and guides from the Legaleezi team will
                  appear here.
                </Text>
              </View>
            ) : (
              <View style={{ gap: 12 }}>
                {items.map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => onPress(t)}
                    disabled={pdfBusy === t.id}
                    className="rounded-2xl bg-app-paper p-4 flex-row items-center gap-3 active:opacity-85"
                    style={{
                      shadowColor: "#0a1124",
                      shadowOpacity: 0.05,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 1 },
                      elevation: 1,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${t.title}`}
                  >
                    <View
                      className="h-11 w-11 items-center justify-center rounded-xl"
                      style={{ backgroundColor: "#efe5d0" }}
                    >
                      {pdfBusy === t.id ? (
                        <ActivityIndicator size="small" color="#8a5821" />
                      ) : (
                        <Feather
                          name={KIND_ICON[t.kind]}
                          size={18}
                          color="#8a5821"
                        />
                      )}
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text
                        className="text-[15px] text-app-ink"
                        style={{ fontFamily: "Crimson-SemiBold" }}
                        numberOfLines={1}
                      >
                        {t.title}
                      </Text>
                      {t.description ? (
                        <Text
                          className="mt-0.5 text-[12px] text-app-fg-muted"
                          style={{ fontFamily: "Manrope" }}
                          numberOfLines={2}
                        >
                          {t.description}
                        </Text>
                      ) : null}
                      <Text
                        className="mt-1 text-[9px] uppercase text-app-copper-deep"
                        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.2 }}
                      >
                        {KIND_LABEL[t.kind]}
                      </Text>
                    </View>
                    <Feather name="chevron-right" size={16} color="#c9bfa6" />
                  </Pressable>
                ))}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Video player — mounted only while a video is selected so the
          player is created with a valid source and released on close. */}
      {video ? (
        <VideoModal
          uri={tutorialFileUrl(video.id)}
          headers={authHeaders}
          title={video.title}
          onClose={() => setVideo(null)}
        />
      ) : null}

      {/* Image viewer */}
      <Modal
        visible={Boolean(image)}
        transparent
        animationType="fade"
        onRequestClose={() => setImage(null)}
        statusBarTranslucent
      >
        <View className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.96)" }}>
          <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
            <View className="flex-row items-center justify-between px-4 py-3">
              <Text
                className="flex-1 text-[15px] text-white"
                style={{ fontFamily: "Manrope-SemiBold" }}
                numberOfLines={1}
              >
                {image?.title}
              </Text>
              <Pressable
                onPress={() => setImage(null)}
                hitSlop={10}
                className="h-9 w-9 items-center justify-center rounded-full"
                style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
                accessibilityLabel="Close"
              >
                <Feather name="x" size={18} color="#fff" />
              </Pressable>
            </View>
            {image ? (
              <Image
                source={{ uri: tutorialFileUrl(image.id), headers: authHeaders }}
                style={{ flex: 1 }}
                resizeMode="contain"
              />
            ) : null}
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

function VideoModal({
  uri,
  headers,
  title,
  onClose,
}: {
  uri: string;
  headers: Record<string, string>;
  title: string;
  onClose: () => void;
}) {
  const player = useVideoPlayer({ uri, headers }, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View className="flex-1" style={{ backgroundColor: "#000000" }}>
        <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
          <View className="flex-row items-center justify-between px-4 py-3">
            <Text
              className="flex-1 text-[15px] text-white"
              style={{ fontFamily: "Manrope-SemiBold" }}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              className="h-9 w-9 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
              accessibilityLabel="Close"
            >
              <Feather name="x" size={18} color="#fff" />
            </Pressable>
          </View>
          <VideoView
            player={player}
            style={{ flex: 1 }}
            allowsFullscreen
            contentFit="contain"
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}
