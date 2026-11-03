import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  partnerCreateCase,
  partnerGetCase,
  ApiError,
  type PartnerCaseInput,
} from "../../../lib/api";
import CaseForm, {
  type CaseFormInitial,
} from "../../../components/cases/CaseForm";
import { useReturnTo } from "../../../components/useReturnTo";
import { caseHref } from "../../../components/cases/useCaseOrigin";

export default function NewCase() {
  const router = useRouter();
  // Opened from the dashboard: back, and the saved matter's own back,
  // return to the dashboard rather than the Case Vault.
  const { origin, goBack } = useReturnTo();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Duplicate matter": ?from=<caseId> pre-fills the parties and court from an
  // existing case. Identifiers and dates stay blank — those are what make the
  // new matter a different matter. The form mounts only once the pre-fill is
  // ready so its initial state is correct.
  const { from } = useLocalSearchParams<{ from?: string }>();
  const [initial, setInitial] = useState<CaseFormInitial | undefined>(undefined);
  const [loadingInitial, setLoadingInitial] = useState(!!from);

  useEffect(() => {
    if (!from) return;
    let alive = true;
    (async () => {
      try {
        const res = await partnerGetCase(String(from));
        if (!alive) return;
        const c = res.case;
        setInitial({
          clientName: c.clientName || "",
          appearingFor: c.appearingFor || "Petitioner",
          clientPhone: c.clientPhone || "",
          clientWhatsapp: c.clientWhatsapp || "",
          clientAddress: c.clientAddress || "",
          oppositeParty: c.oppositeParty || "",
          oppositeAdvocate: c.oppositeAdvocate || "",
          courtName: c.courtName || "",
          courtPlace: c.courtPlace || "",
          courtHall: c.courtHall || "",
        });
      } catch {
        // Pre-fill is best-effort — a blank form is a fine fallback.
      } finally {
        if (alive) setLoadingInitial(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [from]);

  async function onSubmit(payload: PartnerCaseInput) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await partnerCreateCase(payload);
      router.replace(
        caseHref(res.id, origin === "home" ? "home" : undefined) as never
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save");
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar onBack={goBack} />
        {loadingInitial ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          <CaseForm
            eyebrow="New matter"
            title="Add a Case"
            subtitle="Capture the matter details — you can update next date later."
            submitLabel="Save Case"
            initial={initial}
            submitting={submitting}
            error={error}
            onSubmit={onSubmit}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

function TopBar({ onBack }: { onBack: () => void }) {
  return (
    <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center gap-3">
      <Pressable
        onPress={onBack}
        hitSlop={8}
        className="active:opacity-50"
      >
        <Feather name="arrow-left" size={18} color="#0a1124" />
      </Pressable>
      <Text
        className="text-[14px] font-semibold text-app-ink"
        style={{ fontFamily: "Manrope-SemiBold" }}
      >
        New Case
      </Text>
    </View>
  );
}
