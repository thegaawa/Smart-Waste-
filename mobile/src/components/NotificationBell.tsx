import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme, type ThemeColors } from "@/lib/theme";

/**
 * Header button that opens the notifications screen, with an unread badge.
 * The bell is drawn with plain views so the app needs no icon font.
 */
export function NotificationBell({ unread, onPress }: { unread: number; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
    >
      <View style={styles.bellBody} />
      <View style={styles.bellBase} />
      <View style={styles.bellClapper} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unread > 99 ? "99+" : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    button: { width: 32, height: 32, alignItems: "center", justifyContent: "center", marginRight: 4 },
    bellBody: {
      width: 16,
      height: 15,
      borderTopLeftRadius: 8,
      borderTopRightRadius: 8,
      borderBottomLeftRadius: 2,
      borderBottomRightRadius: 2,
      backgroundColor: colors.text,
      marginTop: -2,
    },
    bellBase: { width: 20, height: 2.5, borderRadius: 2, backgroundColor: colors.text, marginTop: 1 },
    bellClapper: {
      width: 6,
      height: 4,
      borderBottomLeftRadius: 3,
      borderBottomRightRadius: 3,
      backgroundColor: colors.text,
      marginTop: 1,
    },
    badge: {
      position: "absolute",
      top: 0,
      right: -2,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: colors.danger,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 2,
      borderColor: colors.background,
    },
    badgeText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  });
}
