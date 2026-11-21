import { isLikelyEmail, isValidPhone } from "@smart-waste/shared";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { type TextInput } from "react-native";

import { ErrorBanner, LinkButton, PrimaryButton, Screen, Spacer, Subtitle, TextField, Title } from "@/components/ui";
import { describeError, isApiRequestError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { spacing, ThemeToggle } from "@/lib/theme";

type Errors = Partial<Record<"name" | "email" | "phone" | "password" | "confirm", string>>;

/** Citizen sign-up. Email or phone (or both) plus a password. */
export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();

  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function validate(): boolean {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = "Enter your full name";
    const hasEmail = email.trim().length > 0;
    const hasPhone = phone.trim().length > 0;
    if (!hasEmail && !hasPhone) next.email = "Enter an email address or a phone number";
    if (hasEmail && !isLikelyEmail(email)) next.email = "Enter a valid email address";
    if (hasPhone && !isValidPhone(phone)) next.phone = "Enter a valid phone number, e.g. 0803 123 4567";
    if (password.length < 8) next.password = "Password must be at least 8 characters";
    if (confirm !== password) next.confirm = "Passwords do not match";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit() {
    setFormError(null);
    if (!validate()) return;
    setSubmitting(true);
    try {
      await register({
        name: name.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        password,
      });
    } catch (error) {
      if (isApiRequestError(error) && error.details.length > 0) {
        setErrors({
          name: error.fieldMessage("name"),
          email: error.fieldMessage("email"),
          phone: error.fieldMessage("phone"),
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
      <Spacer size={spacing.lg} />
      <Title>Create account</Title>
      <Subtitle>Use an email address, a phone number, or both.</Subtitle>

      <ErrorBanner message={formError} />

      <TextField
        label="Full name"
        placeholder="e.g. Domale Gaawa"
        value={name}
        onChangeText={setName}
        error={errors.name}
        autoCapitalize="words"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
      />
      <TextField
        ref={emailRef}
        label="Email (optional if you give a phone)"
        placeholder="name@example.com"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="next"
        onSubmitEditing={() => phoneRef.current?.focus()}
      />
      <TextField
        ref={phoneRef}
        label="Phone (optional if you give an email)"
        placeholder="0803 123 4567"
        value={phone}
        onChangeText={setPhone}
        error={errors.phone}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
      />
      <TextField
        ref={passwordRef}
        label="Password"
        placeholder="At least 8 characters"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
        textContentType="newPassword"
        returnKeyType="next"
        onSubmitEditing={() => confirmRef.current?.focus()}
      />
      <TextField
        ref={confirmRef}
        label="Confirm password"
        placeholder="Repeat your password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureTextEntry
        textContentType="newPassword"
        returnKeyType="done"
        onSubmitEditing={handleSubmit}
      />

      <Spacer size={spacing.sm} />
      <PrimaryButton title="Create account" onPress={handleSubmit} loading={submitting} />
      <Spacer />
      <LinkButton title="Already have an account? Sign in" onPress={() => router.back()} />
      <Spacer size={spacing.lg} />
      <ThemeToggle />
    </Screen>
  );
}
