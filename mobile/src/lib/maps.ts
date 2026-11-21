import { Linking, Platform } from "react-native";

/** Opens the phone's map app at a report location; falls back to Google Maps on the web. */
export function openInMaps(latitude: number, longitude: number, label: string): void {
  const web = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
  const native = Platform.select({
    android: `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodeURIComponent(label)})`,
    ios: `maps:0,0?q=${encodeURIComponent(label)}@${latitude},${longitude}`,
    default: web,
  });
  Linking.openURL(native).catch(() => Linking.openURL(web).catch(() => undefined));
}
