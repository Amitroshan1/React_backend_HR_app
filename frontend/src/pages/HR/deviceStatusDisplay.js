/**
 * HR biometric device status display helpers (DB timestamps only).
 * Run: node src/pages/HR/deviceStatusDisplay.test.js
 */

export function formatDeviceClock(iso) {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function deviceDisplayName(device) {
  if (!device) return "Biometric Device";
  const name = (device.name || "").trim();
  const sn = (device.serial_number || "").trim();
  if (name && sn) return `${name} (${sn})`;
  return name || sn || "Biometric Device";
}

export function pickPrimaryDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (!list.length) return null;
  const active = list.filter((d) => d.is_active !== false);
  const pool = active.length ? active : list;
  const online = pool.find((d) => d.online);
  return online || pool[0];
}
