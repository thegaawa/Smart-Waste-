import type { Priority, ReportStatus } from "@smart-waste/shared";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Platform, Pressable, StyleSheet, Text } from "react-native";

export type ThemeMode = "light" | "dark";

export type ThemeColors = {
  primary: string;
  primaryDark: string;
  primarySoft: string;
  background: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  warningSoft: string;
  info: string;
  infoSoft: string;
  shadow: string;
};

const STORAGE_KEY = "smart-waste.theme";

export const lightColors: ThemeColors = {
  primary: "#1A8F5A",
  primaryDark: "#0F5C3A",
  primarySoft: "#E6F6EE",
  background: "#EEF5F0",
  surface: "#FFFFFF",
  text: "#0F1F17",
  muted: "#5B6B62",
  border: "#D5E3DA",
  danger: "#B91C1C",
  dangerSoft: "#FEE2E2",
  warning: "#B45309",
  warningSoft: "#FEF3C7",
  info: "#1D4ED8",
  infoSoft: "#DBEAFE",
  shadow: "rgba(15, 31, 23, 0.08)",
};

export const darkColors: ThemeColors = {
  primary: "#3ECF8E",
  primaryDark: "#7DDEA8",
  primarySoft: "#163528",
  background: "#0C1410",
  surface: "#152019",
  text: "#E8F2EC",
  muted: "#9BB0A4",
  border: "#2A3D32",
  danger: "#F87171",
  dangerSoft: "#3F1D1D",
  warning: "#FBBF24",
  warningSoft: "#3D2E12",
  info: "#93C5FD",
  infoSoft: "#1E3A5F",
  shadow: "rgba(0, 0, 0, 0.35)",
};

/** Default export kept for modules that cannot use hooks (e.g. push channel setup). */
export const colors = lightColors;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
} as const;

export function statusColorsFor(palette: ThemeColors): Record<ReportStatus, { background: string; text: string }> {
  return {
    NEW: { background: palette.infoSoft, text: palette.info },
    VALIDATED: { background: palette === darkColors ? "#2E2450" : "#EDE9FE", text: palette === darkColors ? "#C4B5FD" : "#5B21B6" },
    ASSIGNED: { background: palette.warningSoft, text: palette.warning },
    IN_PROGRESS: { background: palette.warningSoft, text: palette.warning },
    RESOLVED: { background: palette.primarySoft, text: palette.primaryDark },
    CLOSED: { background: palette === darkColors ? "#2A3330" : "#E5E7EB", text: palette === darkColors ? "#C5D0CA" : "#374151" },
    REJECTED: { background: palette.dangerSoft, text: palette.danger },
  };
}

export function priorityColorsFor(palette: ThemeColors): Record<Priority, { background: string; text: string }> {
  return {
    LOW: { background: palette === darkColors ? "#2A3330" : "#E5E7EB", text: palette === darkColors ? "#C5D0CA" : "#374151" },
    MEDIUM: { background: palette.infoSoft, text: palette.info },
    HIGH: { background: palette.dangerSoft, text: palette.danger },
  };
}

/** @deprecated Prefer statusColorsFor(useTheme().colors) — kept for light-mode fallbacks. */
export const statusColors = statusColorsFor(lightColors);
/** @deprecated Prefer priorityColorsFor(useTheme().colors). */
export const priorityColors = priorityColorsFor(lightColors);

interface ThemeContextValue {
  mode: ThemeMode;
  isDark: boolean;
  colors: ThemeColors;
  statusColors: ReturnType<typeof statusColorsFor>;
  priorityColors: ReturnType<typeof priorityColorsFor>;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
  ready: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

async function readStoredMode(): Promise<ThemeMode | null> {
  try {
    const raw =
      Platform.OS === "web"
        ? typeof localStorage === "undefined"
          ? null
          : localStorage.getItem(STORAGE_KEY)
        : await SecureStore.getItemAsync(STORAGE_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    // ignore
  }
  return null;
}

async function writeStoredMode(mode: ThemeMode): Promise<void> {
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage !== "undefined") localStorage.setItem(STORAGE_KEY, mode);
      return;
    }
    await SecureStore.setItemAsync(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = await readStoredMode();
      if (!cancelled && stored) setModeState(stored);
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void writeStoredMode(next);
  }, []);

  const toggle = useCallback(() => {
    setModeState((current) => {
      const next = current === "dark" ? "light" : "dark";
      void writeStoredMode(next);
      return next;
    });
  }, []);

  const palette = mode === "dark" ? darkColors : lightColors;

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      isDark: mode === "dark",
      colors: palette,
      statusColors: statusColorsFor(palette),
      priorityColors: priorityColorsFor(palette),
      setMode,
      toggle,
      ready,
    }),
    [mode, palette, ready, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}

/** Compact Light / Dark control for auth and home footers. */
export function ThemeToggle() {
  const { isDark, toggle, colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onPress={toggle}
      style={({ pressed }) => [
        toggleStyles.button,
        { backgroundColor: colors.primarySoft, borderColor: colors.border },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Text style={[toggleStyles.label, { color: colors.primaryDark }]}>{isDark ? "Light mode" : "Dark mode"}</Text>
    </Pressable>
  );
}

const toggleStyles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  label: { fontSize: 15, fontWeight: "700" },
});
