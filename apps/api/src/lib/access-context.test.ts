import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("empreinte navigateur en production", () => {
  it("refuse une empreinte absente et ne produit qu’un HMAC pour une valeur présente", () => {
    const script = `
      import { hashDeviceFingerprint } from "./src/lib/access-context.ts";
      try {
        hashDeviceFingerprint(undefined);
        process.exit(2);
      } catch (error) {
        console.log(error.code);
      }
      console.log(hashDeviceFingerprint("visitor-id-brut"));
    `;
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          SESSION_SECRET: "production-session-secret-0123456789",
          DEVICE_FINGERPRINT_SECRET: "production-device-secret-0123456789",
          DATABASE_URL: "postgres://user:pass@localhost:5432/maxoujeux",
          ADMIN_EMAIL: "admin@example.com",
          ADMIN_PSEUDO: "Admin",
          ADMIN_PASSWORD: "mot-de-passe-administrateur",
          PUBLIC_ORIGIN: "https://maxoujeux.example",
        },
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("DEVICE_FINGERPRINT_REQUIRED");
    expect(lines[1]).toMatch(/^[a-f0-9]{64}$/);
    expect(result.stdout).not.toContain("visitor-id-brut");
  });
});
