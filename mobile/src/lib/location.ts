import * as Location from "expo-location";

/** Map centre when the phone has no GPS fix yet (Lagos Island). */
export const LAGOS_CENTRE = { latitude: 6.5244, longitude: 3.3792 } as const;

export type LocationFailure = "denied" | "off" | "timeout";

export class LocationError extends Error {
  readonly reason: LocationFailure;

  constructor(reason: LocationFailure, message: string) {
    super(message);
    this.name = "LocationError";
    this.reason = reason;
  }
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
}

function timeout(ms: number): Promise<never> {
  return new Promise((_resolve, reject) => {
    setTimeout(() => reject(new LocationError("timeout", "GPS is taking too long")), ms);
  });
}

/**
 * Current GPS position (FR-03). Asks for permission first; falls back to the
 * last known position when a fresh fix takes too long. Every failure carries a
 * plain-language message that tells the user what to do next.
 */
export async function getCurrentCoordinates(timeoutMs = 20_000): Promise<Coordinates> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new LocationError(
      "denied",
      "Location permission was not given. You can still place the pin on the map yourself",
    );
  }

  const enabled = await Location.hasServicesEnabledAsync().catch(() => true);
  if (!enabled) {
    throw new LocationError("off", "Location (GPS) is switched off on this phone. Turn it on, or place the pin on the map yourself");
  }

  try {
    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout(timeoutMs),
    ]);
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracyMeters: position.coords.accuracy ?? null,
    };
  } catch (error) {
    const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }).catch(() => null);
    if (lastKnown) {
      return {
        latitude: lastKnown.coords.latitude,
        longitude: lastKnown.coords.longitude,
        accuracyMeters: lastKnown.coords.accuracy ?? null,
      };
    }
    if (error instanceof LocationError) {
      throw new LocationError(
        "timeout",
        "Could not get a GPS fix. Move to an open area and try again, or place the pin on the map yourself",
      );
    }
    throw new LocationError("timeout", "Could not read your location. Try again, or place the pin on the map yourself");
  }
}

/** Street / area text for coordinates, when the phone can look it up. Never throws. */
export async function describeCoordinates(latitude: number, longitude: number): Promise<string | null> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return null;
    const street = place.street ? [place.streetNumber, place.street].filter(Boolean).join(" ") : place.name;
    const parts = [street, place.district ?? place.subregion, place.city ?? place.region]
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .map((part) => part.trim());
    const unique = parts.filter((part, index) => parts.indexOf(part) === index);
    return unique.length > 0 ? unique.join(", ") : null;
  } catch {
    return null;
  }
}
