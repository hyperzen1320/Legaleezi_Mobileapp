import { Pressable, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { DateField } from "../CaseFields";

// The disposal record — recorded date, C.A. (certified-copy) status, a
// note, and whether the client has the copy.
//
// Controlled inputs only: no save button, no API call, no opinion about
// where it's rendered. DisposePanel owns the full archive lever on the
// case page; Hearing Track needs the same four fields inline the moment a
// status is set to "Disposed", which is what the client asked for and
// what neither the pending card nor the update sheet offered.
//
// Keeping the fields here means the two places can't drift on what a
// disposal record contains.

// The certified-copy chase, in the order it actually runs: nothing filed
// yet → applied for → ready at the counter → collected. "Not yet" sits
// last because it's the one an office picks to say the chase hasn't
// started, and it reads oddly at the front of a progression.
export const CA_OPTIONS = ["Applied", "Ready", "Delivered", "Not yet"];

/** Placeholder for the free-text field that backs the chips. */
export const CA_PLACEHOLDER = CA_OPTIONS.join(" / ");

export type DisposalRecord = {
  disposalDate: string;
  caStatus: string;
  disposalRemarks: string;
  receivedByClient: boolean;
};

export const EMPTY_DISPOSAL: DisposalRecord = {
  disposalDate: "",
  caStatus: "",
  disposalRemarks: "",
  receivedByClient: false,
};

/** en-CA formats as YYYY-MM-DD in local time — no UTC day-drift in IST. */
export function todayLocal(): string {
  return new Date().toLocaleDateString("en-CA");
}

export default function DisposalFields({
  value,
  onChange,
  compact,
}: {
  value: DisposalRecord;
  onChange: (next: DisposalRecord) => void;
  /** Tighter spacing for the inline card on Hearing Track. */
  compact?: boolean;
}) {
  const set = <K extends keyof DisposalRecord>(
    key: K,
    v: DisposalRecord[K]
  ) => onChange({ ...value, [key]: v });

  const gap = compact ? "mt-3" : "mt-4";

  return (
    <View>
      <DateField
        label="Disposed date"
        value={value.disposalDate}
        onChange={(v) => set("disposalDate", v)}
      />

      <Text
        className={`text-[10px] uppercase text-app-copper-deep ${gap} mb-2`}
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        C.A. status
      </Text>
      <View className="flex-row flex-wrap mb-2" style={{ gap: 8 }}>
        {CA_OPTIONS.map((opt) => {
          const on = value.caStatus.trim().toLowerCase() === opt.toLowerCase();
          return (
            <Pressable
              key={opt}
              onPress={() => set("caStatus", on ? "" : opt)}
              className="rounded-full px-3 py-1.5 active:opacity-70"
              style={{
                backgroundColor: on ? "#0a1124" : "#ffffff",
                borderWidth: 1,
                borderColor: on ? "#0a1124" : "#e3d9c0",
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text
                className="text-[12px]"
                style={{
                  fontFamily: on ? "Manrope-SemiBold" : "Manrope",
                  color: on ? "#f5ebd6" : "#0a1124",
                }}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {/* The chips are the common cases; the field stays free text because
          offices word this differently. */}
      <TextInput
        value={value.caStatus}
        onChangeText={(v) => set("caStatus", v)}
        placeholder={CA_PLACEHOLDER}
        placeholderTextColor="#a89c80"
        className="rounded-xl bg-app-paper px-3.5 py-3 text-[14px] text-app-ink"
        style={{
          fontFamily: "Manrope",
          borderWidth: 1,
          borderColor: "#e3d9c0",
        }}
      />

      <Text
        className={`text-[10px] uppercase text-app-copper-deep ${gap} mb-2`}
        style={{ fontFamily: "DMMono-Medium", letterSpacing: 1.8 }}
      >
        Disposal note (optional)
      </Text>
      <TextInput
        value={value.disposalRemarks}
        onChangeText={(v) => set("disposalRemarks", v)}
        placeholder="Decree passed / settled / withdrawn — how did it end?"
        placeholderTextColor="#a89c80"
        multiline
        className="rounded-xl bg-app-paper px-3.5 py-3 text-[14px] text-app-ink"
        style={{
          fontFamily: "Manrope",
          minHeight: compact ? 72 : 84,
          textAlignVertical: "top",
          borderWidth: 1,
          borderColor: "#e3d9c0",
        }}
      />

      <Pressable
        onPress={() => set("receivedByClient", !value.receivedByClient)}
        className={`${gap} flex-row items-center gap-2.5 active:opacity-70`}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value.receivedByClient }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 6,
            borderWidth: 1.5,
            borderColor: value.receivedByClient ? "#c5853a" : "#c9bfa6",
            backgroundColor: value.receivedByClient
              ? "#c5853a"
              : "transparent",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {value.receivedByClient ? (
            <Feather name="check" size={14} color="#2a1c08" />
          ) : null}
        </View>
        <Text
          className="text-[14px] text-app-ink"
          style={{ fontFamily: "Manrope-Medium" }}
        >
          Received by client
        </Text>
      </Pressable>
    </View>
  );
}
