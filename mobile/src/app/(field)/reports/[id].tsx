import {
  AssignmentStatus,
  REPORT_STATUS_CITIZEN_MESSAGES,
  ReportStatus,
  Role,
  nextStatusesFor,
  type ReportDetailDto,
} from "@smart-waste/shared";
import { Image } from "expo-image";
import { Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useState, useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LeafletMap } from "@/components/LeafletMap";
import { KeyValue, PriorityChip, SectionTitle, StatusChip, Timeline } from "@/components/report-ui";
import { Card, CenteredLoader, ErrorBanner, InfoBanner, LinkButton, PrimaryButton, TextField } from "@/components/ui";
import { describeError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { formatCoordinates, formatDateTime } from "@/lib/format";
import { openInMaps } from "@/lib/maps";
import { useTasksApi } from "@/lib/tasks";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";

type Busy = "acknowledge" | "start" | "resolve" | null;

/**
 * Task detail for a field officer (Figure 4.6, FR-07): the report, where it
 * is, and the buttons Acknowledge -> Start work -> Mark as resolved.
 * Which buttons show is decided by the same transition table the API uses.
 */
export default function FieldTaskScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const api = useTasksApi();

  const [report, setReport] = useState<ReportDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(null);

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

  async function run(kind: Exclude<Busy, null>, action: () => Promise<unknown>, message: string) {
    setBusy(kind);
    setActionError(null);
    setSuccess(null);
    try {
      await action();
      await load();
      setSuccess(message);
    } catch (err) {
      setActionError(describeError(err));
    } finally {
      setBusy(null);
    }
  }

  if (!report && !error) return <CenteredLoader />;

  const assignment = report?.assignment ?? null;
  const mine = assignment !== null && assignment.assignee.id === user?.id;
  const allowed = report ? nextStatusesFor(report.status, Role.FIELD) : [];
  const canStart = mine && allowed.includes(ReportStatus.IN_PROGRESS);
  const canResolve = mine && allowed.includes(ReportStatus.RESOLVED);
  const canAcknowledge = mine && assignment.status === AssignmentStatus.PENDING;

  return (
    <>
      <Stack.Screen options={{ title: report?.reference ?? "Task" }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.lg }]}
        keyboardShouldPersistTaps="handled"
      >
        {error ? (
          <View>
            <ErrorBanner message={error} />
            <PrimaryButton title="Try again" variant="secondary" onPress={() => void load()} />
          </View>
        ) : null}

        {report ? (
          <>
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

            {success ? (
              <View style={styles.successBanner}>
                <Text style={styles.successText}>{success}</Text>
              </View>
            ) : null}

            <SectionTitle>Your task</SectionTitle>
            <Card>
              {assignment ? (
                <>
                  <KeyValue label="Assigned by" value={assignment.assignedBy.name} />
                  <KeyValue label="Assigned" value={formatDateTime(assignment.assignedAt)} />
                  {assignment.dueAt ? <KeyValue label="Due" value={formatDateTime(assignment.dueAt)} /> : null}
                  <KeyValue label="Task status" value={ASSIGNMENT_LABELS[assignment.status]} />
                  {assignment.note ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Instruction</Text>
                      <Text style={styles.noteText}>{assignment.note}</Text>
                    </View>
                  ) : null}
                </>
              ) : (
                <Text style={styles.mutedText}>No active assignment on this report.</Text>
              )}
            </Card>

            <ErrorBanner message={actionError} />
            {!mine ? (
              <InfoBanner message="This task was moved to another officer. You can still read the report, but not update it." />
            ) : null}

            {canAcknowledge ? (
              <View style={styles.action}>
                <PrimaryButton
                  title="Acknowledge task"
                  variant="secondary"
                  loading={busy === "acknowledge"}
                  disabled={busy !== null}
                  onPress={() =>
                    void run("acknowledge", () => api.acknowledge(assignment.id), "Task acknowledged. The administrator can see you have it.")
                  }
                />
              </View>
            ) : null}

            {canStart ? (
              <View style={styles.action}>
                <PrimaryButton
                  title="Start work"
                  loading={busy === "start"}
                  disabled={busy !== null}
                  onPress={() =>
                    void run(
                      "start",
                      async () => {
                        // Starting work implies the task was seen.
                        if (assignment.status === AssignmentStatus.PENDING) await api.acknowledge(assignment.id);
                        await api.updateStatus(report.id, { status: ReportStatus.IN_PROGRESS });
                      },
                      `Status updated: ${REPORT_STATUS_CITIZEN_MESSAGES.IN_PROGRESS}. The citizen has been notified.`,
                    )
                  }
                />
              </View>
            ) : null}

            {canResolve ? (
              <View style={styles.action}>
                <TextField
                  label="Completion note (optional)"
                  placeholder="e.g. Cleared 12 bags, area disinfected"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  numberOfLines={3}
                  maxLength={500}
                  style={styles.noteInput}
                  editable={busy === null}
                />
                <PrimaryButton
                  title="Mark as resolved"
                  loading={busy === "resolve"}
                  disabled={busy !== null}
                  onPress={() =>
                    void run(
                      "resolve",
                      () =>
                        api.updateStatus(report.id, {
                          status: ReportStatus.RESOLVED,
                          ...(note.trim() ? { note: note.trim() } : {}),
                        }),
                      `Status updated: ${REPORT_STATUS_CITIZEN_MESSAGES.RESOLVED}. The citizen has been notified.`,
                    )
                  }
                />
              </View>
            ) : null}

            {report.status === ReportStatus.RESOLVED ? (
              <InfoBanner
                message={`Marked as resolved${report.resolvedAt ? ` on ${formatDateTime(report.resolvedAt)}` : ""}. The administrator will check and close it.`}
              />
            ) : null}
            {report.status === ReportStatus.CLOSED ? <InfoBanner message="This report is closed." /> : null}

            {report.media.length > 0 ? (
              <>
                <SectionTitle>Photos</SectionTitle>
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
              </>
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
              <KeyValue label="Reported" value={formatDateTime(report.createdAt)} />
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

const ASSIGNMENT_LABELS: Record<AssignmentStatus, string> = {
  PENDING: "New — not acknowledged yet",
  ACKNOWLEDGED: "Acknowledged",
  COMPLETED: "Completed",
  REASSIGNED: "Reassigned",
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.md },
  headerText: { flex: 1 },
  reference: { fontSize: 24, fontWeight: "700", color: colors.text },
  category: { fontSize: 16, color: colors.muted, marginTop: 2 },
  chipRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  successBanner: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  successText: { color: colors.primaryDark, fontSize: 14, fontWeight: "600" },
  noteBox: { marginTop: spacing.sm, backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.sm },
  noteLabel: { fontSize: 12, color: colors.muted, fontWeight: "600", marginBottom: 2 },
  noteText: { fontSize: 15, color: colors.text },
  mutedText: { color: colors.muted },
  action: { marginTop: spacing.md },
  noteInput: { minHeight: 80, textAlignVertical: "top" },
  photos: { marginTop: spacing.xs, borderRadius: radius.lg },
  photo: { width: 320, height: 220, borderRadius: radius.lg, marginRight: spacing.sm, backgroundColor: colors.border },
  description: { fontSize: 15, color: colors.text, lineHeight: 22 },
  map: { height: 180 },
  locationCard: { marginTop: spacing.sm },
  address: { fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: 2 },
  coords: { fontSize: 13, color: colors.muted },
});
}

