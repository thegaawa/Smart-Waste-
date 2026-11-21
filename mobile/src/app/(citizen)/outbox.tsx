import { useRouter } from "expo-router";
import { useState, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState, PhotoStrip } from "@/components/report-ui";
import { Card, CenteredLoader, ErrorBanner, LinkButton, PrimaryButton, ProgressBar, Subtitle } from "@/components/ui";
import { describeError } from "@/lib/api";
import { formatCoordinates, formatShortDateTime } from "@/lib/format";
import { removePending, useOutbox, type PendingReport } from "@/lib/outbox";
import { useSendReport } from "@/lib/send-report";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";
import type { UploadProgress } from "@/lib/upload";

interface SentInfo {
  id: string;
  reference: string;
}

/**
 * "Not sent yet" (Chapter 4.6, T09): reports saved on the phone because the
 * server never confirmed them. Each one can be retried (same idempotency key,
 * so no duplicates) or deleted.
 */
export default function OutboxScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const items = useOutbox();
  const { sendPending } = useSendReport();

  const [sendingId, setSendingId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<SentInfo | null>(null);
  const [sendingAll, setSendingAll] = useState(false);

  async function retry(entry: PendingReport): Promise<boolean> {
    setSendingId(entry.id);
    setProgress({ sent: 0, total: 1, fraction: 0 });
    setError(null);
    try {
      const report = await sendPending(entry, { onProgress: setProgress });
      setLastSent({ id: report.id, reference: report.reference });
      return true;
    } catch (err) {
      setError(describeError(err));
      return false;
    } finally {
      setSendingId(null);
      setProgress(null);
    }
  }

  async function retryAll() {
    if (!items) return;
    setSendingAll(true);
    for (const entry of items) {
      const ok = await retry(entry);
      if (!ok) break; // Still offline: stop instead of failing every item in turn.
    }
    setSendingAll(false);
  }

  async function discard(entry: PendingReport) {
    setError(null);
    try {
      await removePending(entry.id);
    } catch (err) {
      setError(describeError(err));
    }
  }

  if (items === null) return <CenteredLoader />;

  const busy = sendingId !== null || sendingAll;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}>
      <Subtitle>
        These reports are saved on your phone and have not been confirmed by the server yet. Nothing is lost.
        Retry when you have a connection.
      </Subtitle>

      {lastSent ? (
        <View style={styles.sentBanner}>
          <Text style={styles.sentTitle}>Sent · {lastSent.reference}</Text>
          <LinkButton
            title="Open report"
            onPress={() => router.push({ pathname: "/(citizen)/reports/[id]", params: { id: lastSent.id } })}
          />
        </View>
      ) : null}

      <ErrorBanner message={error} />

      {items.length === 0 ? (
        <Card>
          <EmptyState title="Nothing waiting" message="Every report you wrote has been received by the server." />
        </Card>
      ) : (
        <>
          {items.length > 1 ? (
            <View style={styles.retryAll}>
              <PrimaryButton title={`Retry all (${items.length})`} onPress={() => void retryAll()} loading={sendingAll} disabled={busy} />
            </View>
          ) : null}

          {items.map((entry) => {
            const sending = sendingId === entry.id;
            return (
              <Card key={entry.id} style={styles.item}>
                <View style={styles.itemTop}>
                  <Text style={styles.itemCategory}>{entry.categoryName}</Text>
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>Not sent yet</Text>
                  </View>
                </View>
                <Text style={styles.itemDescription} numberOfLines={3}>
                  {entry.description}
                </Text>
                <Text style={styles.itemMeta} numberOfLines={1}>
                  {entry.location.address ?? formatCoordinates(entry.location.latitude, entry.location.longitude)}
                </Text>
                <Text style={styles.itemMeta}>
                  Saved {formatShortDateTime(entry.savedAt)}
                  {entry.photos.length > 0 ? ` · ${entry.photos.length} photo${entry.photos.length === 1 ? "" : "s"}` : ""}
                  {entry.attempts > 0 ? ` · ${entry.attempts} ${entry.attempts === 1 ? "attempt" : "attempts"}` : ""}
                </Text>
                {entry.lastError && !sending ? <Text style={styles.itemError}>Last try: {entry.lastError}</Text> : null}
                <PhotoStrip uris={entry.photos.map((photo) => photo.uri)} size={64} style={styles.strip} />

                {sending && progress ? (
                  <ProgressBar
                    fraction={progress.fraction}
                    caption={
                      progress.fraction >= 1
                        ? "Waiting for the server to confirm…"
                        : progress.fraction > 0
                          ? `Sending… ${Math.round(progress.fraction * 100)}%`
                          : "Preparing…"
                    }
                  />
                ) : null}

                <View style={styles.buttonRow}>
                  <View style={styles.buttonHalf}>
                    <PrimaryButton title="Retry" onPress={() => void retry(entry)} loading={sending} disabled={busy} />
                  </View>
                  <View style={styles.buttonHalf}>
                    <PrimaryButton title="Delete" variant="danger" onPress={() => void discard(entry)} disabled={busy} />
                  </View>
                </View>
              </Card>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, flexGrow: 1 },
  sentBanner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sentTitle: { color: colors.primaryDark, fontWeight: "700", fontSize: 15 },
  retryAll: { marginBottom: spacing.md },
  item: { marginBottom: spacing.md, gap: 4 },
  itemTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  itemCategory: { fontSize: 16, fontWeight: "700", color: colors.text },
  badge: { backgroundColor: colors.warningSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { color: colors.warning, fontSize: 12, fontWeight: "700" },
  itemDescription: { fontSize: 15, color: colors.text, lineHeight: 21 },
  itemMeta: { fontSize: 13, color: colors.muted },
  itemError: { fontSize: 13, color: colors.danger, marginTop: 2 },
  strip: { marginTop: spacing.sm, marginBottom: spacing.sm },
  buttonRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  buttonHalf: { flex: 1 },
});
}

