import {
  MAX_REPORT_PHOTOS,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  type CategoryDto,
} from "@smart-waste/shared";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState, useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { Chip, PhotoStrip, SectionTitle } from "@/components/report-ui";
import { Card, ErrorBanner, PrimaryButton, ProgressBar, Screen, Spacer, TextField } from "@/components/ui";
import { describeError, isApiRequestError } from "@/lib/api";
import { formatAccuracy, formatCoordinates } from "@/lib/format";
import { describeCoordinates, getCurrentCoordinates } from "@/lib/location";
import { removePending } from "@/lib/outbox";
import { takePhoto } from "@/lib/photos";
import { useReportDraft } from "@/lib/report-draft";
import { useReportsApi } from "@/lib/reports";
import { isUnconfirmedFailure, isValidationFailure, useSendReport } from "@/lib/send-report";
import { radius, spacing, useTheme, type ThemeColors } from "@/lib/theme";
import type { UploadProgress } from "@/lib/upload";

interface FieldErrors {
  categoryId?: string;
  description?: string;
  location?: string;
  photos?: string;
}

/**
 * New waste report (Figure 4.3, FR-02/FR-03). Everything is checked on the
 * phone before anything is sent, so a slow network is never wasted on a form
 * the API would refuse anyway.
 */
export default function NewReportScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const router = useRouter();
  const api = useReportsApi();
  const { sendDraft } = useSendReport();
  const { draft, patch, addPhotos, removePhoto, setLocation, reset } = useReportDraft();

  const [categories, setCategories] = useState<CategoryDto[] | null>(null);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  /** True after a send the server did not confirm: the report is kept in the outbox. */
  const [unconfirmed, setUnconfirmed] = useState(false);

  const loadCategories = useCallback(async () => {
    setCategoriesError(null);
    try {
      setCategories(await api.categories());
    } catch (error) {
      setCategoriesError(describeError(error));
    }
  }, [api]);

  const locate = useCallback(async () => {
    setLocating(true);
    setLocationError(null);
    try {
      const coords = await getCurrentCoordinates();
      const address = await describeCoordinates(coords.latitude, coords.longitude);
      setLocation({ ...coords, address, source: "gps" });
      setFieldErrors((current) => ({ ...current, location: undefined }));
    } catch (error) {
      setLocationError(describeError(error));
    } finally {
      setLocating(false);
    }
  }, [setLocation]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  // Ask for the GPS position as soon as the form opens, unless the draft already has one.
  useEffect(() => {
    if (!draft.location) void locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remainingPhotos = MAX_REPORT_PHOTOS - draft.photos.length;

  async function handleTakePhoto() {
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const photo = await takePhoto();
      if (photo) addPhotos([photo]);
    } catch (error) {
      setPhotoError(describeError(error));
    } finally {
      setPhotoBusy(false);
    }
  }

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (!draft.categoryId) errors.categoryId = "Choose what kind of problem this is";
    const description = draft.description.trim();
    if (description.length < REPORT_DESCRIPTION_MIN_LENGTH) {
      errors.description = `Describe the problem in at least ${REPORT_DESCRIPTION_MIN_LENGTH} characters`;
    }
    if (!draft.location) errors.location = "Add the location of the problem";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  /**
   * Send (T09 behaviour): the draft is saved on the phone first, then uploaded
   * with the same idempotency key. The success screen only appears when the
   * server has answered with the stored report. Anything else is shown as a
   * failure with a Retry button — never as a false "sent".
   */
  async function handleSubmit() {
    setFormError(null);
    setUnconfirmed(false);
    if (!validate() || !draft.categoryId || !draft.location) return;
    const categoryName = categories?.find((c) => c.id === draft.categoryId)?.name ?? "Waste report";
    setSubmitting(true);
    setProgress({ sent: 0, total: 1, fraction: 0 });
    try {
      const report = await sendDraft(
        {
          categoryId: draft.categoryId,
          categoryName,
          description: draft.description.trim(),
          location: draft.location,
          photos: draft.photos,
          idempotencyKey: draft.idempotencyKey,
        },
        { onProgress: setProgress },
      );
      reset();
      router.replace({ pathname: "/reports/[id]", params: { id: report.id, created: "1" } });
    } catch (error) {
      if (isValidationFailure(error)) {
        // The data itself was refused: fix the form and send again. Nothing to keep in the outbox.
        void removePending(draft.idempotencyKey);
        if (isApiRequestError(error) && error.details.length > 0) {
          setFieldErrors({
            categoryId: error.fieldMessage("categoryId"),
            description: error.fieldMessage("description"),
            location: error.fieldMessage("latitude") ?? error.fieldMessage("longitude") ?? error.fieldMessage("address"),
            photos: error.fieldMessage("photos"),
          });
        }
      } else if (isUnconfirmedFailure(error)) {
        setUnconfirmed(true);
      }
      setFormError(describeError(error));
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  /** Leave the report in the outbox and go back home, where "Not sent yet" shows it. */
  function keepForLater() {
    reset();
    router.replace("/(citizen)");
  }

  const location = draft.location;
  const progressCaption =
    progress && progress.fraction >= 1
      ? "Waiting for the server to confirm…"
      : progress && progress.fraction > 0
        ? `Sending… ${Math.round(progress.fraction * 100)}%`
        : "Preparing your report…";

  return (
    <Screen>
      {!unconfirmed || submitting ? <ErrorBanner message={formError} /> : null}
      {unconfirmed && !submitting ? (
        <View style={styles.unconfirmedCard}>
          <Text style={styles.unconfirmedTitle}>Not sent yet</Text>
          <Text style={styles.unconfirmedText}>
            Your report is saved on this phone. Nothing was lost. Retry now, or keep it and send it later from
            the home screen.
          </Text>
          {formError ? <Text style={styles.unconfirmedReason}>Reason: {formError}</Text> : null}
          <View style={styles.buttonRow}>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Retry now" onPress={() => void handleSubmit()} />
            </View>
            <View style={styles.buttonHalf}>
              <PrimaryButton title="Keep for later" variant="secondary" onPress={keepForLater} />
            </View>
          </View>
        </View>
      ) : null}

      <SectionTitle>What is the problem?</SectionTitle>
      {categories === null && !categoriesError ? (
        <ActivityIndicator color={colors.primary} />
      ) : categoriesError ? (
        <View>
          <ErrorBanner message={categoriesError} />
          <PrimaryButton title="Try again" variant="secondary" onPress={() => void loadCategories()} />
        </View>
      ) : (
        <View style={styles.chips}>
          {categories?.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              selected={draft.categoryId === category.id}
              onPress={() => {
                patch({ categoryId: category.id });
                setFieldErrors((current) => ({ ...current, categoryId: undefined }));
              }}
            />
          ))}
        </View>
      )}
      {fieldErrors.categoryId ? <Text style={styles.fieldError}>{fieldErrors.categoryId}</Text> : null}

      <Spacer />
      <TextField
        label="Describe it"
        placeholder="For example: refuse heap blocking the drainage beside the bus stop"
        value={draft.description}
        onChangeText={(text) => {
          patch({ description: text });
          if (fieldErrors.description) setFieldErrors((current) => ({ ...current, description: undefined }));
        }}
        error={fieldErrors.description}
        multiline
        numberOfLines={4}
        maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
        textAlignVertical="top"
        style={styles.multiline}
      />
      <Text style={styles.counter}>
        {draft.description.trim().length}/{REPORT_DESCRIPTION_MAX_LENGTH}
      </Text>

      <SectionTitle>Photos (optional)</SectionTitle>
      <Text style={styles.hint}>
        Up to {MAX_REPORT_PHOTOS} photos, taken with the camera. A photo already saved on the phone cannot be attached.
        Photos are made smaller before sending, to save data.
      </Text>
      <PhotoStrip uris={draft.photos.map((photo) => photo.uri)} onRemove={removePhoto} style={styles.strip} />
      <PrimaryButton
        title="Take photo"
        variant="secondary"
        onPress={() => void handleTakePhoto()}
        disabled={remainingPhotos <= 0}
        loading={photoBusy}
      />
      {photoError ? <Text style={styles.fieldError}>{photoError}</Text> : null}
      {fieldErrors.photos ? <Text style={styles.fieldError}>{fieldErrors.photos}</Text> : null}

      <SectionTitle>Where is it?</SectionTitle>
      <Card style={fieldErrors.location ? styles.cardError : undefined}>
        {locating ? (
          <View style={styles.locatingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.locatingText}>Finding your location…</Text>
          </View>
        ) : location ? (
          <View>
            <Text style={styles.locationTitle}>{location.address ?? "Location captured"}</Text>
            <Text style={styles.locationMeta}>{formatCoordinates(location.latitude, location.longitude)}</Text>
            <Text style={styles.locationMeta}>
              {location.source === "gps"
                ? `From GPS${formatAccuracy(location.accuracyMeters) ? ` (accuracy ${formatAccuracy(location.accuracyMeters)})` : ""}`
                : "Placed on the map"}
            </Text>
          </View>
        ) : (
          <Text style={styles.locationMeta}>No location yet.</Text>
        )}
        {locationError ? <Text style={styles.fieldError}>{locationError}</Text> : null}
        <Spacer size={spacing.sm} />
        <View style={styles.buttonRow}>
          <View style={styles.buttonHalf}>
            <PrimaryButton title="Use GPS" variant="secondary" onPress={() => void locate()} disabled={locating} />
          </View>
          <View style={styles.buttonHalf}>
            <PrimaryButton
              title={location ? "Confirm on map" : "Pick on map"}
              variant="secondary"
              onPress={() => router.push("/report/location")}
              disabled={locating}
            />
          </View>
        </View>
      </Card>
      {fieldErrors.location ? <Text style={styles.fieldError}>{fieldErrors.location}</Text> : null}

      <Spacer size={spacing.lg} />
      {submitting && progress ? <ProgressBar fraction={progress.fraction} caption={progressCaption} /> : null}
      <PrimaryButton
        title={unconfirmed ? "Retry now" : "Send report"}
        onPress={() => void handleSubmit()}
        loading={submitting}
      />
      <Spacer />
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  fieldError: { color: colors.danger, marginTop: spacing.xs, fontSize: 13 },
  multiline: { minHeight: 110, paddingTop: 12 },
  counter: { alignSelf: "flex-end", color: colors.muted, fontSize: 12, marginTop: -spacing.sm },
  hint: { color: colors.muted, fontSize: 13, marginBottom: spacing.sm },
  strip: { marginBottom: spacing.sm },
  buttonRow: { flexDirection: "row", gap: spacing.sm },
  buttonHalf: { flex: 1 },
  cardError: { borderColor: colors.danger },
  locatingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  locatingText: { color: colors.muted },
  locationTitle: { fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: 2 },
  locationMeta: { fontSize: 13, color: colors.muted },
  unconfirmedCard: {
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  unconfirmedTitle: { color: colors.warning, fontWeight: "700", fontSize: 16 },
  unconfirmedText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  unconfirmedReason: { color: colors.muted, fontSize: 13 },
});
}

