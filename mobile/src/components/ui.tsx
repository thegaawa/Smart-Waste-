import { forwardRef, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";

function useUiStyles() {
  const { colors } = useTheme();
  return useMemo(() => createStyles(colors), [colors]);
}

/** Full-height screen with safe-area padding and keyboard handling. */
export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useUiStyles();
  const insets = useSafeAreaInsets();
  const padding = {
    paddingTop: insets.top + spacing.md,
    paddingBottom: insets.bottom + spacing.md,
    paddingLeft: insets.left + spacing.md,
    paddingRight: insets.right + spacing.md,
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      {scroll ? (
        <ScrollView
          style={[styles.flex, styles.screen]}
          contentContainerStyle={[padding, styles.grow, style]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.flex, styles.screen, padding, style]}>{children}</View>
      )}
    </KeyboardAvoidingView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  const styles = useUiStyles();
  return <Text style={styles.title}>{children}</Text>;
}

export function Subtitle({ children }: { children: ReactNode }) {
  const styles = useUiStyles();
  return <Text style={styles.subtitle}>{children}</Text>;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const styles = useUiStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | undefined;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, style, secureTextEntry, ...inputProps },
  ref,
) {
  const { colors } = useTheme();
  const styles = useUiStyles();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const isPassword = secureTextEntry === true;
  const hidePassword = isPassword && !passwordVisible;

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.inputRow}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.muted}
          style={[styles.input, isPassword ? styles.inputWithToggle : null, error ? styles.inputError : null, style]}
          {...inputProps}
          secureTextEntry={hidePassword}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? "Hide password" : "Show password"}
            onPress={() => setPasswordVisible((visible) => !visible)}
            hitSlop={8}
            style={styles.eyeButton}
          >
            <Text style={styles.eyeLabel}>{passwordVisible ? "Hide" : "Show"}</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
});

export function PrimaryButton({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = "primary",
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "secondary" | "danger";
}) {
  const { colors } = useTheme();
  const styles = useUiStyles();
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        pressed && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.primary : "#FFFFFF"} />
      ) : (
        <Text style={[styles.buttonText, variant === "secondary" && styles.buttonTextSecondary]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function LinkButton({ title, onPress }: { title: string; onPress: () => void }) {
  const styles = useUiStyles();
  return (
    <Pressable accessibilityRole="link" onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{title}</Text>
    </Pressable>
  );
}

/** Red banner for a whole-form problem (wrong password, no network, ...). */
export function ErrorBanner({ message }: { message: string | null }) {
  const styles = useUiStyles();
  if (!message) return null;
  return (
    <View style={styles.errorBanner} accessibilityLiveRegion="polite">
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

export function InfoBanner({ message }: { message: string }) {
  const styles = useUiStyles();
  return (
    <View style={styles.infoBanner}>
      <Text style={styles.infoBannerText}>{message}</Text>
    </View>
  );
}

export function Spacer({ size = spacing.md }: { size?: number }) {
  return <View style={{ height: size }} />;
}

/** Upload progress (0..1) with a caption, e.g. "Sending… 45%". */
export function ProgressBar({ fraction, caption }: { fraction: number; caption: string }) {
  const styles = useUiStyles();
  const percent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return (
    <View
      style={styles.progressWrap}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent, text: caption }}
    >
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${percent}%` }]} />
      </View>
      <Text style={styles.progressCaption}>{caption}</Text>
    </View>
  );
}

export function CenteredLoader() {
  const { colors } = useTheme();
  const styles = useUiStyles();
  return (
    <View style={[styles.flex, styles.center, styles.screen]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    flex: { flex: 1 },
    grow: { flexGrow: 1 },
    center: { alignItems: "center", justifyContent: "center" },
    screen: { backgroundColor: colors.background },
    title: {
      fontSize: 30,
      fontWeight: "800",
      color: colors.text,
      marginBottom: spacing.xs,
      letterSpacing: -0.4,
    },
    subtitle: { fontSize: 16, color: colors.muted, marginBottom: spacing.lg, lineHeight: 22 },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      borderWidth: 1,
      borderColor: colors.border,
      ...Platform.select({
        ios: {
          shadowColor: colors.shadow,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 1,
          shadowRadius: 12,
        },
        android: { elevation: 2 },
        default: {},
      }),
    },
    field: { marginBottom: spacing.md },
    label: { fontSize: 14, fontWeight: "700", color: colors.text, marginBottom: spacing.xs },
    inputRow: { position: "relative", justifyContent: "center" },
    input: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.text,
    },
    inputWithToggle: { paddingRight: 64 },
    inputError: { borderColor: colors.danger },
    eyeButton: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      paddingHorizontal: spacing.md,
      alignItems: "center",
      justifyContent: "center",
    },
    eyeLabel: { fontSize: 14, color: colors.primaryDark, fontWeight: "700" },
    fieldError: { color: colors.danger, marginTop: spacing.xs, fontSize: 13 },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: 15,
      alignItems: "center",
      justifyContent: "center",
      minHeight: 52,
    },
    buttonSecondary: { backgroundColor: colors.primarySoft },
    buttonDanger: { backgroundColor: colors.danger },
    buttonPressed: { opacity: 0.88 },
    buttonDisabled: { opacity: 0.6 },
    buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700", letterSpacing: -0.1 },
    buttonTextSecondary: { color: colors.primaryDark },
    link: { paddingVertical: spacing.sm, alignItems: "center" },
    linkText: { color: colors.primaryDark, fontSize: 15, fontWeight: "700" },
    errorBanner: {
      backgroundColor: colors.dangerSoft,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    errorBannerText: { color: colors.danger, fontSize: 14, fontWeight: "500" },
    infoBanner: {
      backgroundColor: colors.infoSoft,
      borderRadius: radius.md,
      padding: spacing.md,
      marginBottom: spacing.md,
    },
    infoBannerText: { color: colors.info, fontSize: 14, fontWeight: "500" },
    progressWrap: { marginBottom: spacing.md },
    progressTrack: { height: 8, borderRadius: 4, backgroundColor: colors.border, overflow: "hidden" },
    progressFill: { height: "100%", backgroundColor: colors.primary, borderRadius: 4 },
    progressCaption: { color: colors.muted, fontSize: 13, marginTop: spacing.xs },
  });
}
