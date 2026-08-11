/**
 * Reconnaissance des erreurs PostgreSQL par leur code SQLSTATE.
 *
 * Les deux pilotes (postgres-js et PGlite) exposent ce code sur la propriété
 * `code` de l'erreur levée, ce qui permet de traiter une violation de
 * contrainte comme un cas métier plutôt que comme un bug.
 */

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";

function sqlState(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const { code } = error as { code: unknown };
  return typeof code === "string" ? code : undefined;
}

/** Contrainte d'unicité violée — sert à détecter un doublon en concurrence. */
export function isUniqueViolation(error: unknown): boolean {
  return sqlState(error) === UNIQUE_VIOLATION;
}

/**
 * Contrainte `CHECK` violée. Sur `wallets`, cela signale un débit passé hors du
 * service de porte-monnaie : c'est un bug, pas un cas métier.
 */
export function isCheckViolation(error: unknown): boolean {
  return sqlState(error) === CHECK_VIOLATION;
}
