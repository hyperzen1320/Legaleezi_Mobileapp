import { useEffect, useState } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Feather } from "@expo/vector-icons";
import {
  partnerGetCase,
  partnerUpdateCase,
  ApiError,
  type PartnerCaseInput,
} from "../../../../lib/api";
import CaseForm, {
  type CaseFormInitial,
} from "../../../../components/cases/CaseForm";
import { backToList } from "../../../../lib/navigation";

export default function EditCase() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const caseId = String(id);

  const [initial, setInitial] = useState<CaseFormInitial | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await partnerGetCase(caseId);
        if (!alive) return;
        const c = res.case;
        setInitial({
          fileNo: c.fileNo || "",
          caseNo: c.caseNo || "",
          iaNumbers: c.iaNumbers || "",
          cnr: c.cnr || "",
          clientName: c.clientName || "",
          appearingFor: c.appearingFor || "Petitioner",
          clientWhatsapp: c.clientWhatsapp || "",
          clientPhone: c.clientPhone || "",
          oppositeParty: c.oppositeParty || "",
          oppositeAdvocate: c.oppositeAdvocate || "",
          courtName: c.courtName || "",
          status: c.status || "Filed",
          previousDate: c.lastHearingDate ? c.lastHearingDate.slice(0, 10) : "",
          nextHearingDate: c.nextHearingDate
            ? c.nextHearingDate.slice(0, 10)
            : "",
          courtPlace: c.courtPlace || "",
          courtHall: c.courtHall || "",
          clientAddress: c.clientAddress || "",
        });
      } catch (err) {
        if (alive) {
          setLoadError(
            err instanceof ApiError ? err.message : "Couldn't load this case."
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  async function onSubmit(payload: PartnerCaseInput) {
    setError(null);
    setSubmitting(true);
    try {
      const res = await partnerUpdateCase(caseId, payload);
      // Web parity: moving a matter to "Disposed" sends it to the archive.
      if (res.case.status === "Disposed") {
        // Unwind the dossier too — a matter that has just been archived
        // isn't a screen to land back on.
        router.dismissAll();
        router.push("/(home)/cases/disposed" as never);
      } else {
        // Back down to the dossier that opened this editor. `replace`
        // swapped the editor for a SECOND dossier and left the first one
        // underneath, so backing out of a matter you had just edited
        // walked through the same matter twice.
        backToList(`/(home)/cases/${caseId}` as never);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save");
      setSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-app-canvas">
      <StatusBar style="dark" backgroundColor="#f4ede0" />
      <SafeAreaView className="flex-1" edges={["top"]}>
        <TopBar />
        {loadError ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text
              className="text-center text-[14px] text-app-fg-muted"
              style={{ fontFamily: "Manrope" }}
            >
              {loadError}
            </Text>
          </View>
        ) : !initial ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator color="#c5853a" size="large" />
          </View>
        ) : (
          <CaseForm
            eyebrow="Edit matter"
            title="Edit Case"
            subtitle="Update any detail and save — your changes sync to web instantly."
            submitLabel="Save Changes"
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

function TopBar() {
  const router = useRouter();
  return (
    <View className="border-b border-app-edge bg-app-canvas px-5 py-3.5 flex-row items-center gap-3">
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        className="active:opacity-50"
      >
        <Feather name="arrow-left" size={18} color="#0a1124" />
      </Pressable>
      <Text
        className="text-[14px] font-semibold text-app-ink"
        style={{ fontFamily: "Manrope-SemiBold" }}
      >
        Edit Case
      </Text>
    </View>
  );
}
