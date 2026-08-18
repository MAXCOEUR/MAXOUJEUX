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
  const visited = new Set<object>();
  let current = error;

  while (typeof current === "object" && current !== null && !visited.has(current)) {
    visited.add(current);

    if ("code" in current) {
      const { code } = current as { code: unknown };
      if (typeof code === "string") return code;
    }

    current = "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }

  return undefined;
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
