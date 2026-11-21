import type { ReportDetailDto } from "@smart-waste/shared";
import { Image } from "expo-image";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeafletMap } from "@/components/LeafletMap";
import { KeyValue, PriorityChip, SectionTitle, StatusChip, Timeline } from "@/components/report-ui";
import { Card, CenteredLoader, ErrorBanner, LinkButton, PrimaryButton } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatCoordinates, formatDateTime } from "@/lib/format";
import { openInMaps } from "@/lib/maps";
import { useReportsApi } from "@/lib/reports";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";

/** Report detail (Figure 4.5): status, photos, location and the full timeline (FR-05, FR-10). */
export default function ReportDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, created } = useLocalSearchParams<{ id: string; created?: string }>();
  const insets = useSafeAreaInsets();
  const api = useReportsApi();

  const [report, setReport] = useState<ReportDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      setReport(await api.report(id));
    } catch (err) {
      setError(describeError(err));
    }
  }, [api, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!report && !error) return <CenteredLoader />;

  return (
    <>
      <Stack.Screen options={{ title: report?.reference ?? "Report" }} />
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
        {error ? (
          <View>
            <ErrorBanner message={error} />
            <PrimaryButton title="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : null}

        {report ? (
          <>
            {created === "1" ? (
              <View style={styles.successBanner}>
                <Text style={styles.successTitle}>Report sent</Text>
                <Text style={styles.successText}>
                  Your reference is {report.reference}. You will see every status change here.
                </Text>
              </View>
            ) : null}

            <View style={styles.header}>
              <View style={styles.headerText}>
                <Text style={styles.reference}>{report.reference}</Text>
                <Text style={styles.category}>{report.category.name}</Text>
              </View>
              <StatusChip status={report.status} />
            </View>
            <View style={styles.chipRow}>
              <PriorityChip priority={report.priority} />
            </View>

            {report.media.length > 0 ? (
              <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.photos}>
                {report.media.map((media) => (
                  <Image
                    key={media.id}
                    source={{ uri: media.url }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={200}
                    accessibilityLabel="Report photo"
                  />
                ))}
              </ScrollView>
            ) : null}

            <SectionTitle>Description</SectionTitle>
            <Card>
              <Text style={styles.description}>{report.description}</Text>
            </Card>

            <SectionTitle
              right={
                <LinkButton
                  title="Open in maps"
                  onPress={() => openInMaps(report.latitude, report.longitude, report.reference)}
                />
              }
            >
              Location
            </SectionTitle>
            <LeafletMap
              initialPosition={{ latitude: report.latitude, longitude: report.longitude }}
              zoom={16}
              style={styles.map}
            />
            <Card style={styles.locationCard}>
              {report.address ? <Text style={styles.address}>{report.address}</Text> : null}
              <Text style={styles.coords}>{formatCoordinates(report.latitude, report.longitude)}</Text>
            </Card>

            <SectionTitle>Details</SectionTitle>
            <Card>
              <KeyValue label="Sent" value={formatDateTime(report.createdAt)} />
              <KeyValue label="Last update" value={formatDateTime(report.updatedAt)} />
              {report.validatedAt ? <KeyValue label="Validated" value={formatDateTime(report.validatedAt)} /> : null}
              {report.resolvedAt ? <KeyValue label="Resolved" value={formatDateTime(report.resolvedAt)} /> : null}
              {report.closedAt ? <KeyValue label="Closed" value={formatDateTime(report.closedAt)} /> : null}
            </Card>

            <SectionTitle>Timeline</SectionTitle>
            <Card>
              <Timeline history={report.history} />
            </Card>
          </>
        ) : null}
      </ScrollView>
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  successBanner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  successTitle: { color: colors.primaryDark, fontWeight: "700", fontSize: 16, marginBottom: 2 },
  successText: { color: colors.primaryDark, fontSize: 14 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  headerText: { flex: 1 },
  reference: { fontSize: 24, fontWeight: "700", color: colors.text },
  category: { fontSize: 16, color: colors.muted, marginTop: 2 },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  photos: { marginTop: spacing.md, borderRadius: radius.lg },
  photo: { width: 320, height: 220, borderRadius: radius.lg, marginRight: spacing.sm, backgroundColor: colors.border },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  map: { height: 180 },
  locationCard: { marginTop: spacing.sm },
  address: { fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: 2 },
  coords: { fontSize: 13, color: colors.muted },
});
}

