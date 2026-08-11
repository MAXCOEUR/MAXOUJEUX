import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id — le choix recommandé par l'OWASP pour le stockage de mots de passe.
 * Paramètres calibrés pour le CPU ARM du NAS : environ 100 ms par hachage,
 * assez lent pour décourager le cassage hors ligne, assez rapide pour ne pas
 * bloquer la boucle d'événements sur une connexion.
 */
const OPTIONS = {
  memoryCost: 19_456, // 19 Mio, minimum OWASP
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(digest: string, plain: string): Promise<boolean> {
  try {
    return await verify(digest, plain, OPTIONS);
  } catch {
    // Hash corrompu ou format inconnu : on refuse sans faire remonter d'erreur 500.
    return false;
  }
}

/**
 * Consomme le même temps qu'une vérification réelle lorsque l'email est inconnu.
 * Sans cela, la différence de latence permettrait d'énumérer les comptes existants.
 *
 * Le hash leurre est calculé au premier appel plutôt qu'écrit en dur : un hash
 * codé en dur devenu invalide échouerait instantanément et supprimerait
 * silencieusement la protection.
 */
let decoyHash: Promise<string> | undefined;

export async function burnTimingBudget(): Promise<void> {
  decoyHash ??= hashPassword(randomBytes(32).toString("hex"));
  await verifyPassword(await decoyHash, "mot-de-passe-factice");
}
