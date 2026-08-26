import { useState } from "react";
import {
  Modal,
  Pressable,
  View,
  Text,
  ScrollView,
} from "react-native";
import { Feather } from "@expo/vector-icons";

export type ListOption = { id: string; title: string };

/**
 * Bottom-sheet modal triggered by a long-press on a card. Lets the user
 * pick a destination list to move the card to, jump into the card
 * detail screen for full editing, or delete the card.
 *
 * The sheet uses RN's native Modal so we avoid pulling in a third-party
 * bottom-sheet library. Slide-up animation comes from `animationType`,
 * dismissal via tapping the backdrop.
 */
export default function CardActionsSheet({
  visible,
  cardTitle,
  currentListId,
  lists,
  onClose,
  onMoveToList,
  onOpen,
  onDelete,
}: {
  visible: boolean;
  cardTitle: string;
  currentListId: string;
  lists: ListOption[];
  onClose: () => void;
  onMoveToList: (listId: string) => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const [moveMode, setMoveMode] = useState(false);
  const otherLists = lists.filter((l) => l.id !== currentListId);

  function close() {
    setMoveMode(false);
    onClose();
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={close}
    >
      <Pressable
        onPress={close}
        className="flex-1 justify-end"
        style={{ backgroundColor: "rgba(10,17,36,0.55)" }}
      >
        <Pressable
          onPress={() => {
            /* swallow */
          }}
          className="rounded-t-3xl"
          style={{
            backgroundColor: "#ffffff",
            paddingTop: 8,
            paddingBottom: 24,
            shadowColor: "#0a1124",
            shadowOpacity: 0.2,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: -6 },
            elevation: 12,
          }}
        >
          <View
            className="self-center mb-2 h-1.5 w-12 rounded-full"
            style={{ backgroundColor: "#e3d9c0" }}
          />
          <View className="px-5 pb-2">
            <Text
              className="text-[10px] uppercase text-app-copper-deep"
              style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
            >
              Card
            </Text>
            <Text
              className="text-[18px] tracking-tight text-app-ink mt-0.5"
              style={{ fontFamily: "Crimson-SemiBold" }}
              numberOfLines={2}
            >
              {cardTitle}
            </Text>
          </View>

          {moveMode ? (
            <View>
              <View
                className="px-5 py-2 flex-row items-center"
                style={{ gap: 8 }}
              >
                <Pressable onPress={() => setMoveMode(false)} hitSlop={6}>
                  <Feather name="chevron-left" size={16} color="#7a7060" />
                </Pressable>
                <Text
                  className="text-[10px] uppercase text-app-fg-muted"
                  style={{
                    fontFamily: "DMMono-Medium",
                    letterSpacing: 1.4,
                  }}
                >
                  Move to list
                </Text>
              </View>
              <ScrollView
                style={{ maxHeight: 320 }}
                showsVerticalScrollIndicator={false}
              >
                {otherLists.length === 0 ? (
                  <View className="px-5 py-6">
                    <Text
                      className="text-[13px] text-app-fg-muted text-center"
                      style={{ fontFamily: "Manrope" }}
                    >
                      No other lists on this board yet.
                    </Text>
                  </View>
                ) : (
                  otherLists.map((l) => (
                    <Pressable
                      key={l.id}
                      onPress={() => {
                        onMoveToList(l.id);
                        close();
                      }}
                      className="active:bg-app-canvas-2"
                      style={{
                        paddingHorizontal: 20,
                        paddingVertical: 14,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <Feather name="arrow-right" size={14} color="#8a5821" />
                      <Text
                        className="flex-1 text-[14px] text-app-ink"
                        style={{ fontFamily: "Manrope-SemiBold" }}
                        numberOfLines={1}
                      >
                        {l.title}
                      </Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </View>
          ) : (
            <View>
              <SheetAction
                icon="arrow-right"
                label="Move to another list"
                onPress={() => setMoveMode(true)}
              />
              <SheetAction
                icon="edit-2"
                label="Open card"
                onPress={() => {
                  onOpen();
                  close();
                }}
              />
              <SheetAction
                icon="trash-2"
                label="Delete card"
                tone="danger"
                onPress={() => {
                  onDelete();
                  close();
                }}
              />
              <View className="px-5 mt-2">
                <Pressable
                  onPress={close}
                  className="active:opacity-50 items-center"
                  style={{
                    paddingVertical: 12,
                    backgroundColor: "#f4ede0",
                    borderRadius: 10,
                  }}
                  accessibilityLabel="Cancel"
                >
                  <Text
                    className="text-[13px]"
                    style={{
                      fontFamily: "Manrope-Medium",
                      color: "#4d4538",
                    }}
                  >
                    Cancel
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetAction({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  tone?: "danger";
  onPress: () => void;
}) {
  const colour = tone === "danger" ? "#c14a37" : "#0a1124";
  return (
    <Pressable
      onPress={onPress}
      className="active:bg-app-canvas-2"
      style={{
        paddingHorizontal: 20,
        paddingVertical: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
      }}
      accessibilityRole="button"
    >
      <View
        className="h-7 w-7 items-center justify-center rounded-md"
        style={{
          backgroundColor: tone === "danger" ? "#f6dccd" : "#efe5d0",
        }}
      >
        <Feather name={icon} size={13} color={colour} />
      </View>
      <Text
        className="text-[14px]"
        style={{
          fontFamily: "Manrope-SemiBold",
          color: colour,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
