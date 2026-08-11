type ClassValue = string | number | false | null | undefined;

/** Concaténation conditionnelle de classes — évite une dépendance pour dix lignes. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
