import { classifyIdentifier } from "@smart-waste/shared";
import { useRouter } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View, type TextInput } from "react-native";

import { ErrorBanner, LinkButton, PrimaryButton, Screen, Spacer, Subtitle, TextField, Title } from "@/components/ui";
import { describeError, isApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { radius, spacing, ThemeToggle, useTheme, type ThemeColors } from "@/lib/theme";

/** Sign-in screen (Figure 4.1). Works with an email address or a phone number. */
export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const passwordRef = useRef<TextInput>(null);

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ identifier?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const errors: { identifier?: string; password?: string } = {};
    if (identifier.trim().length === 0) errors.identifier = "Enter your email or phone number";
    else if (!classifyIdentifier(identifier)) errors.identifier = "Enter a valid email address or phone number";
    if (password.length === 0) errors.password = "Enter your password";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await signIn({ identifier: identifier.trim(), password });
    } catch (error) {
      if (isApiRequestError(error) && error.details.length > 0) {
        setFieldErrors({
          identifier: error.fieldMessage("identifier"),
          password: error.fieldMessage("password"),
        });
      }
      setFormError(describeError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.logo}>
          <Text style={styles.logoText} accessibilityLabel="Smart-Waste">♻️</Text>
        </View>
        <Title>Smart-Waste</Title>
        <Subtitle>Report waste problems in your community and track what happens next.</Subtitle>
      </View>

      <ErrorBanner message={formError} />

      <TextField
        label="Email or phone"
        placeholder="name@example.com or 0803 123 4567"
        value={identifier}
        onChangeText={setIdentifier}
        error={fieldErrors.identifier}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        placeholder="Your password"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        secureTextEntry
        textContentType="password"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      <Spacer size={spacing.sm} />
      <PrimaryButton title="Sign in" onPress={handleSubmit} loading={submitting} />
      <Spacer />
      <LinkButton title="New here? Create an account" onPress={() => router.push("/register")} />
      <Spacer size={spacing.lg} />
      <ThemeToggle />
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    header: { alignItems: "flex-start", marginTop: spacing.xl, marginBottom: spacing.md },
    logo: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    logoText: { fontSize: 34, lineHeight: 40 },
  });
}
