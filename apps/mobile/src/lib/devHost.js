// Single source of truth for the dev backend host.
//
// In __DEV__ the mobile app runs on a real device / Expo Go and must
// reach the laptop running the backend over the LAN — so this is the
// LAPTOP'S LAN IP, not localhost.
//
// ⚠️  UPDATE THIS when the laptop's LAN IP changes. A different WiFi
// network almost always means a different IP — run `ipconfig` (Windows)
// or `ifconfig` (macOS/Linux) to find the current one. `api.js` and
// `socket.js` both import from here, so it's a single one-line change.
// (Env-var-based config is a v1.1 improvement; not needed for MVP.)
export const DEV_LAN_IP = '192.168.1.172';
export const DEV_API_HOST = `http://${DEV_LAN_IP}:4000`;
