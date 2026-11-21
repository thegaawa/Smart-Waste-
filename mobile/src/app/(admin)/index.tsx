import { StyleSheet, View } from "react-native";

import { InfoBanner, PrimaryButton, Screen, Spacer, Subtitle, Title } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { spacing } from "@/lib/theme";

/** Administrators work in the web dashboard, not the phone app. */
export default function AdminNoticeScreen() {
  const { user, signOut } = useAuth();

  return (
    <Screen>
      <Spacer size={spacing.xl} />
      <Title>Administrator account</Title>
      <Subtitle>You are signed in as {user?.name}.</Subtitle>
      <InfoBanner message="Administrators manage reports, users and categories from the Smart-Waste web dashboard. This phone app is for citizens and field officers." />
      <View style={styles.footer}>
        <PrimaryButton title="Sign out" onPress={() => void signOut()} variant="secondary" />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: "auto", paddingTop: spacing.xl },
});
