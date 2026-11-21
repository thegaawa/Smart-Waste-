import { useRouter } from "expo-router";
import { useCallback, useRef, useState, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeafletMap, type LeafletMapHandle, type MapPosition } from "@/components/LeafletMap";
import { ErrorBanner, PrimaryButton, Spacer, TextField } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatCoordinates } from "@/lib/format";
import { LAGOS_CENTRE, describeCoordinates, getCurrentCoordinates } from "@/lib/location";
import { useReportDraft } from "@/lib/report-draft";
import { spacing, useTheme, type ThemeColors } from "@/lib/theme";

/**
 * Location confirmation (Figure 4.4, FR-03, test case T05): the pin starts at
 * the GPS position; the citizen can drag it or tap the map, then press
 * "Use this location".
 */
export default function ConfirmLocationScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { draft, setLocation } = useReportDraft();
  const mapRef = useRef<LeafletMapHandle>(null);

  const start: MapPosition = draft.location
    ? { latitude: draft.location.latitude, longitude: draft.location.longitude }
    : LAGOS_CENTRE;

  const [position, setPosition] = useState<MapPosition>(start);
  const [moved, setMoved] = useState(false);
  const [address, setAddress] = useState(draft.location?.address ?? "");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleMove = useCallback((next: MapPosition) => {
    setPosition(next);
    setMoved(true);
  }, []);

  async function useGps() {
    setLocating(true);
    setError(null);
    try {
      const coords = await getCurrentCoordinates();
      const next = { latitude: coords.latitude, longitude: coords.longitude };
      setPosition(next);
      setMoved(false);
      mapRef.current?.setPosition(next, 17);
      const found = await describeCoordinates(next.latitude, next.longitude);
      if (found) setAddress(found);
      setLocation({ ...coords, address: found, source: "gps" });
    } catch (err) {
      setError(describeError(err));
    } finally {
      setLocating(false);
    }
  }

  async function confirm() {
    setSaving(true);
    try {
      const typed = address.trim();
      const looked = typed.length > 0 ? null : await describeCoordinates(position.latitude, position.longitude);
      const keepGps = !moved && draft.location?.source === "gps";
      setLocation({
        latitude: position.latitude,
        longitude: position.longitude,
        accuracyMeters: keepGps ? (draft.location?.accuracyMeters ?? null) : null,
        address: typed.length > 0 ? typed : looked,
        source: keepGps ? "gps" : "map",
      });
      router.back();
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingBottom: insets.bottom + spacing.md }]}>
      <LeafletMap
        ref={mapRef}
        initialPosition={start}
        zoom={draft.location ? 17 : 12}
        interactive
        onMove={handleMove}
        style={styles.map}
      />

      <View style={styles.panel}>
        <Text style={styles.help}>Drag the pin or tap the map to put it exactly where the problem is.</Text>
        <Text style={styles.coords}>{formatCoordinates(position.latitude, position.longitude)}</Text>
        <ErrorBanner message={error} />
        <TextField
          label="Street or landmark (optional)"
          placeholder="For example: beside Ikeja bus stop"
          value={address}
          onChangeText={setAddress}
          autoCapitalize="sentences"
        />
        <View style={styles.row}>
          <View style={styles.half}>
            <PrimaryButton title="Use my GPS" variant="secondary" onPress={() => void useGps()} loading={locating} />
          </View>
          <View style={styles.half}>
            <PrimaryButton title="Use this location" onPress={() => void confirm()} loading={saving} disabled={locating} />
          </View>
        </View>
        <Spacer size={spacing.xs} />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  map: { flex: 1, margin: spacing.md, marginBottom: 0 },
  panel: { padding: spacing.md },
  help: { color: colors.muted, fontSize: 14, marginBottom: spacing.xs },
  coords: { fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm },
  half: { flex: 1 },
});
}

