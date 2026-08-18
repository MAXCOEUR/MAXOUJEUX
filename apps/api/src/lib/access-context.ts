import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { env, isProduction } from "../env.js";
import { AppError } from "./errors.js";

export const DEVICE_HEADER = "x-maxoujeux-device";

export function normalizeIp(value: string): string {
  const trimmed = value.trim().toLowerCase();
  const mapped = trimmed.startsWith("::ffff:") ? trimmed.slice(7) : trimmed;
  return isIP(mapped) === 4 ? mapped : trimmed;
}

/** Ne persiste et ne journalise jamais l'empreinte brute. */
export function hashDeviceFingerprint(fingerprint: string | undefined): string | null {
  const normalized = fingerprint?.trim();
  if (!normalized) {
    if (isProduction) {
      throw new AppError(
        400,
        "DEVICE_FINGERPRINT_REQUIRED",
        "L’identifiant de cet appareil est requis",
      );
    }
    return null;
  }

  const secret = env.DEVICE_FINGERPRINT_SECRET ?? env.SESSION_SECRET;
  return createHmac("sha256", secret).update(normalized).digest("hex");
}
