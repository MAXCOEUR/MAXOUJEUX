import FingerprintJS from "@fingerprintjs/fingerprintjs";

let fingerprintPromise: Promise<string | null> | null = null;

/** Empreinte brute gardée uniquement en mémoire, puis HMAC côté serveur. */
export function getDeviceFingerprint(): Promise<string | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  fingerprintPromise ??= FingerprintJS.load({ monitoring: false })
    .then((agent) => agent.get())
    .then((result) => result.visitorId)
    .catch(() => null);
  return fingerprintPromise;
}
