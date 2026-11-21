import {
  PRIORITY_LABELS,
  REPORT_STATUS_CITIZEN_MESSAGES,
  REPORT_STATUS_LABELS,
  type Priority,
  type ReportStatus,
  type ReportSummaryDto,
  type StatusHistoryDto,
} from "@smart-waste/shared";
import { Image } from "expo-image";
import { useMemo, type ReactNode } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { formatCoordinates, formatDateTime, formatShortDateTime } from "@/lib/format";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";

function useReportStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

export function StatusChip({ status }: { status: ReportStatus }) {
  const { statusColors } = useTheme();
  const styles = useReportStyles();
  const palette = statusColors[status];
  return (
    <View style={[styles.chip, { backgroundColor: palette.background }]}>
      <Text style={[styles.chipText, { color: palette.text }]}>{REPORT_STATUS_LABELS[status]}</Text>
    </View>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const { priorityColors } = useTheme();
  const styles = useReportStyles();
  const palette = priorityColors[priority];
  return (
    <View style={[styles.chip, { backgroundColor: palette.background }]}>
      <Text style={[styles.chipText, { color: palette.text }]}>{PRIORITY_LABELS[priority]} priority</Text>
    </View>
  );
}

/** Selectable pill used for categories and list filters. */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const styles = useReportStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.selectChip,
        selected && styles.selectChipSelected,
        pressed && { opacity: 0.8 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text style={[styles.selectChipText, selected && styles.selectChipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const styles = useReportStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  const styles = useReportStyles();
  return (
    <View style={styles.keyValue}>
      <Text style={styles.keyLabel}>{label}</Text>
      <Text style={styles.keyText}>{value}</Text>
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  const styles = useReportStyles();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

/** One row in "My reports" (Figure 4.5). */
export function ReportListItem({ report, onPress }: { report: ReportSummaryDto; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useReportStyles();
  const where = report.address ?? formatCoordinates(report.latitude, report.longitude);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.primarySoft }]}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowReference}>{report.reference}</Text>
        <StatusChip status={report.status} />
      </View>
      <Text style={styles.rowCategory}>{report.category.name}</Text>
      <Text style={styles.rowMeta} numberOfLines={1}>
        {where}
      </Text>
      <Text style={styles.rowMeta}>
        {formatShortDateTime(report.createdAt)}
        {report.photoCount > 0 ? ` · ${report.photoCount} photo${report.photoCount === 1 ? "" : "s"}` : ""}
      </Text>
    </Pressable>
  );
}

/** Status history as a vertical timeline (report detail, Figure 4.5). */
export function Timeline({ history }: { history: StatusHistoryDto[] }) {
  const styles = useReportStyles();
  if (history.length === 0) {
    return <Text style={styles.timelineEmpty}>No updates yet.</Text>;
  }
  return (
    <View>
      {history.map((entry, index) => {
        const last = index === history.length - 1;
        return (
          <View key={entry.id} style={styles.timelineRow}>
            <View style={styles.timelineRail}>
              <View style={[styles.timelineDot, last && styles.timelineDotCurrent]} />
              {!last ? <View style={styles.timelineLine} /> : null}
            </View>
            <View style={styles.timelineBody}>
              <Text style={[styles.timelineTitle, last && styles.timelineTitleCurrent]}>
                {REPORT_STATUS_CITIZEN_MESSAGES[entry.newStatus]}
              </Text>
              <Text style={styles.timelineWhen}>{formatDateTime(entry.changedAt)}</Text>
              {entry.note ? <Text style={styles.timelineNote}>{entry.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Horizontal photo thumbnails, with an optional remove button (report form). */
export function PhotoStrip({
  uris,
  onRemove,
  size = 96,
  style,
}: {
  uris: string[];
  onRemove?: (uri: string) => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useReportStyles();
  if (uris.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={style} contentContainerStyle={styles.strip}>
      {uris.map((uri) => (
        <View key={uri} style={[styles.thumbWrap, { width: size, height: size }]}>
          <Image source={{ uri }} style={styles.thumb} contentFit="cover" accessibilityLabel="Report photo" />
          {onRemove ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Remove photo"
              onPress={() => onRemove(uri)}
              style={styles.removeButton}
            >
              <Text style={styles.removeText}>×</Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, alignSelf: "flex-start" },
    chipText: { fontSize: 12, fontWeight: "700" },

    selectChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    selectChipSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    selectChipText: { fontSize: 14, color: colors.text, fontWeight: "500" },
    selectChipTextSelected: { color: colors.primaryDark, fontWeight: "700" },

    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionTitle: { fontSize: 17, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },

    keyValue: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 6 },
    keyLabel: { color: colors.muted, fontSize: 14 },
    keyText: { color: colors.text, fontSize: 14, fontWeight: "600", flexShrink: 1, textAlign: "right" },

    empty: { alignItems: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
    emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
    emptyMessage: { color: colors.muted, textAlign: "center" },

    row: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.sm,
      gap: 2,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 3 },
          shadowOpacity: 1,
          shadowRadius: 10,
        },
        android: { elevation: 1 },
        default: {},
      }),
    },
    rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
    rowReference: { fontSize: 16, fontWeight: "800", color: colors.text, letterSpacing: -0.2 },
    rowCategory: { fontSize: 15, color: colors.text, fontWeight: "500" },
    rowMeta: { fontSize: 13, color: colors.muted },

    timelineRow: { flexDirection: "row", gap: spacing.sm },
    timelineRail: { width: 16, alignItems: "center" },
    timelineDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.border, marginTop: 4 },
    timelineDotCurrent: { backgroundColor: colors.primary },
    timelineLine: { flex: 1, width: 2, backgroundColor: colors.border, marginVertical: 2 },
    timelineBody: { flex: 1, paddingBottom: spacing.md },
    timelineTitle: { fontSize: 15, fontWeight: "600", color: colors.text },
    timelineTitleCurrent: { color: colors.primaryDark },
    timelineWhen: { fontSize: 13, color: colors.muted, marginTop: 2 },
    timelineNote: { fontSize: 14, color: colors.text, marginTop: 4 },
    timelineEmpty: { color: colors.muted },

    strip: { gap: spacing.sm },
    thumbWrap: { borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.border },
    thumb: { width: "100%", height: "100%" },
    removeButton: {
      position: "absolute",
      top: 4,
      right: 4,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: "rgba(17, 24, 39, 0.75)",
      alignItems: "center",
      justifyContent: "center",
    },
    removeText: { color: "#FFFFFF", fontSize: 16, lineHeight: 18, fontWeight: "700" },
  });
}
