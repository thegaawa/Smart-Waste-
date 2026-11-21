import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { colors, radius } from "@/lib/theme";
import { LEAFLET_CSS, LEAFLET_JS } from "@/vendor/leaflet";

export interface MapPosition {
  latitude: number;
  longitude: number;
}

export interface LeafletMapHandle {
  /** Moves the pin (and the view) to a new position. */
  setPosition: (position: MapPosition, zoom?: number) => void;
}

interface LeafletMapProps {
  initialPosition: MapPosition;
  zoom?: number;
  /** When true the pin can be dragged and the map tapped to move it. */
  interactive?: boolean;
  onMove?: (position: MapPosition) => void;
  style?: StyleProp<ViewStyle>;
}

type MapMessage =
  | { type: "ready" }
  | { type: "moved"; latitude: number; longitude: number }
  | { type: "tiles"; state: "loaded" | "error" };

/** What the user sees over the map while the map images (tiles) are fetched. */
type TilesPhase = "loading" | "slow" | "loaded" | "error";

/** After this long without a single map image, tell the user the network is slow. */
const SLOW_NETWORK_MS = 25_000;

/** Pin drawn as inline SVG, so no image files need to be downloaded. */
const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="42" viewBox="0 0 30 42">' +
  '<path d="M15 1C7.3 1 1 7.3 1 15c0 9.6 12.2 24.4 13.2 25.6a1 1 0 0 0 1.6 0C16.8 39.4 29 24.6 29 15 29 7.3 22.7 1 15 1z" fill="#1E8E5A" stroke="#FFFFFF" stroke-width="2"/>' +
  '<circle cx="15" cy="15" r="5.5" fill="#FFFFFF"/></svg>';

/**
 * Map with one pin, drawn by Leaflet + OpenStreetMap inside a WebView. No API
 * key is needed, which keeps the app free to run in Expo Go and in the final
 * APK. Leaflet itself is bundled with the app (see `vendor/leaflet.ts`), so on
 * a slow connection only the map images still have to be downloaded; the pin
 * and the coordinates work even before they arrive.
 * Falls back to an <iframe> in the browser preview.
 */
function buildHtml(position: MapPosition, zoom: number, interactive: boolean): string {
  const lat = Number(position.latitude);
  const lng = Number(position.longitude);
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>${LEAFLET_CSS}</style>
<style>
  html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #E5E7EB; }
  .leaflet-control-attribution { font-size: 10px; }
  .sw-pin { background: transparent; border: 0; }
</style>
</head>
<body>
<div id="map"></div>
<script>${LEAFLET_JS}</script>
<script>
(function () {
  var interactive = ${interactive ? "true" : "false"};
  var map = L.map('map', {
    zoomControl: interactive,
    dragging: interactive,
    touchZoom: interactive,
    scrollWheelZoom: interactive,
    doubleClickZoom: interactive,
    boxZoom: false,
    keyboard: false,
    tap: interactive
  }).setView([${lat}, ${lng}], ${zoom});

  function send(message) {
    var text = JSON.stringify(message);
    if (window.ReactNativeWebView) { window.ReactNativeWebView.postMessage(text); }
    else if (window.parent && window.parent !== window) { window.parent.postMessage(text, '*'); }
  }

  // Tell the app when the first map image arrives, or when they all fail (offline).
  var tilesState = 'loading';
  var failedTiles = 0;
  function setTilesState(next) {
    if (tilesState === next) return;
    tilesState = next;
    send({ type: 'tiles', state: next });
  }
  var tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  });
  tiles.on('tileload', function () { setTilesState('loaded'); });
  tiles.on('tileerror', function () {
    failedTiles += 1;
    if (tilesState === 'loading' && failedTiles >= 3) { setTilesState('error'); }
  });
  tiles.addTo(map);

  var pin = L.divIcon({ className: 'sw-pin', html: ${JSON.stringify(PIN_SVG)}, iconSize: [30, 42], iconAnchor: [15, 42] });
  var marker = L.marker([${lat}, ${lng}], { draggable: interactive, icon: pin, keyboard: false }).addTo(map);

  function reportPosition() {
    var p = marker.getLatLng();
    send({ type: 'moved', latitude: p.lat, longitude: p.lng });
  }
  if (interactive) {
    marker.on('dragend', reportPosition);
    map.on('click', function (e) { marker.setLatLng(e.latlng); reportPosition(); });
  }

  window.__setPosition = function (lat, lng, zoom) {
    marker.setLatLng([lat, lng]);
    if (zoom) { map.setView([lat, lng], zoom); } else { map.panTo([lat, lng]); }
  };
  function onExternalMessage(event) {
    try {
      var data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (data && data.type === 'setPosition') { window.__setPosition(data.latitude, data.longitude, data.zoom); }
    } catch (e) { /* ignore unrelated messages */ }
  }
  window.addEventListener('message', onExternalMessage);
  document.addEventListener('message', onExternalMessage);

  send({ type: 'ready' });
})();
</script>
</body>
</html>`;
}

function parseMessage(raw: unknown): MapMessage | null {
  if (typeof raw !== "string") return null;
  try {
    const data = JSON.parse(raw) as Partial<MapMessage> & { latitude?: unknown; longitude?: unknown; state?: unknown };
    if (data.type === "ready") return { type: "ready" };
    if (data.type === "moved" && typeof data.latitude === "number" && typeof data.longitude === "number") {
      return { type: "moved", latitude: data.latitude, longitude: data.longitude };
    }
    if (data.type === "tiles" && (data.state === "loaded" || data.state === "error")) {
      return { type: "tiles", state: data.state };
    }
  } catch {
    // not one of ours
  }
  return null;
}

export const LeafletMap = forwardRef<LeafletMapHandle, LeafletMapProps>(function LeafletMap(
  { initialPosition, zoom = 16, interactive = false, onMove, style },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Where the pin is now, so a reload (Retry) does not jump back to the start.
  const positionRef = useRef<MapPosition>(initialPosition);
  const zoomRef = useRef<number>(zoom);
  const [reloadCount, setReloadCount] = useState(0);
  const [phase, setPhase] = useState<TilesPhase>("loading");

  // Built once per (re)load: later position changes go through setPosition, not a reload.
  const html = useMemo(
    () => buildHtml(positionRef.current, zoomRef.current, interactive),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reloadCount],
  );

  // Still nothing after a while: the network is slow (or blocked), say so.
  useEffect(() => {
    if (phase !== "loading") return;
    const timer = setTimeout(() => setPhase((current) => (current === "loading" ? "slow" : current)), SLOW_NETWORK_MS);
    return () => clearTimeout(timer);
  }, [phase, reloadCount]);

  const handleMessage = useCallback(
    (message: MapMessage | null) => {
      if (!message) return;
      if (message.type === "moved") {
        positionRef.current = { latitude: message.latitude, longitude: message.longitude };
        onMove?.(positionRef.current);
      } else if (message.type === "tiles") {
        setPhase(message.state);
      }
    },
    [onMove],
  );

  useImperativeHandle(
    ref,
    () => ({
      setPosition: (position, nextZoom) => {
        positionRef.current = position;
        if (nextZoom) zoomRef.current = nextZoom;
        if (Platform.OS === "web") {
          iframeRef.current?.contentWindow?.postMessage(
            JSON.stringify({ type: "setPosition", latitude: position.latitude, longitude: position.longitude, zoom: nextZoom }),
            "*",
          );
        } else {
          webViewRef.current?.injectJavaScript(
            `window.__setPosition(${position.latitude}, ${position.longitude}, ${nextZoom ?? "undefined"}); true;`,
          );
        }
      },
    }),
    [],
  );

  const handleNativeMessage = useCallback(
    (event: WebViewMessageEvent) => handleMessage(parseMessage(event.nativeEvent.data)),
    [handleMessage],
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      handleMessage(parseMessage(event.data));
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleMessage]);

  function retry() {
    setPhase("loading");
    setReloadCount((count) => count + 1);
  }

  return (
    <View style={[styles.container, style]}>
      {Platform.OS === "web" ? (
        <iframe
          key={reloadCount}
          ref={iframeRef}
          title="Map"
          srcDoc={html}
          sandbox="allow-scripts"
          style={{ border: 0, width: "100%", height: "100%" }}
        />
      ) : (
        <WebView
          key={reloadCount}
          ref={webViewRef}
          source={{ html }}
          originWhitelist={["*"]}
          javaScriptEnabled
          domStorageEnabled
          onMessage={handleNativeMessage}
          onError={() => setPhase("error")}
          scrollEnabled={false}
          bounces={false}
          overScrollMode="never"
          nestedScrollEnabled
          setBuiltInZoomControls={false}
          style={styles.webview}
        />
      )}

      {phase === "loading" ? (
        <View style={styles.statusWrap} pointerEvents="none">
          <View style={styles.status} accessibilityRole="progressbar" accessibilityLabel="Loading map">
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.statusText}>Loading map…</Text>
          </View>
        </View>
      ) : phase === "slow" || phase === "error" ? (
        <View style={styles.statusWrap} pointerEvents="box-none">
          <View style={[styles.status, styles.statusProblem]} accessibilityRole="alert">
            <Text style={styles.statusText}>
              {phase === "error"
                ? "Map images could not load. Check your connection."
                : "Map images are slow to load. The pin still works."}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry loading the map"
              onPress={retry}
              hitSlop={8}
              style={({ pressed }) => [styles.retry, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { overflow: "hidden", borderRadius: 12, backgroundColor: "#E5E7EB" },
  webview: { flex: 1, backgroundColor: "#E5E7EB" },
  statusWrap: { position: "absolute", top: 10, left: 10, right: 10, alignItems: "center" },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusProblem: { borderColor: colors.warning, flexWrap: "wrap", justifyContent: "center" },
  statusText: { color: colors.text, fontSize: 13, flexShrink: 1 },
  retry: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.primary },
  retryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
});
