import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LEXIQUE_SHA256 = "8ed5a64373ae798f0485a2a35848c09286b6694c6859abeaab6806594c046993";
const SOLUTION_CATEGORIES = new Set(["NOM", "ADJ", "VER", "ADV"]);
const MIN_SOLUTION_FREQUENCY = 2;
const BATCH_SIZE = 500;
const BEGIN_MARKER = "-- MOTUS_DICTIONARY_BEGIN";
const END_MARKER = "-- MOTUS_DICTIONARY_END";

export interface DictionaryWord {
  word: string;
  length: number;
  isSolution: boolean;
}

function normalize(value: string): string | null {
  const word = value.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();
  return /^[A-Z]{5,8}$/.test(word) ? word : null;
}

/** Transforme le TSV Lexique en liste locale d'essais et de solutions. */
export function buildDictionary(tsv: string, badWordsText: string): DictionaryWord[] {
  const banned = new Set(
    badWordsText
      .split(/\r?\n/)
      .map((word) => normalize(word.trim()))
      .filter((word): word is string => word !== null),
  );
  const words = new Map<string, DictionaryWord>();
  const lines = tsv.split(/\r?\n/);

  for (const line of lines.slice(1)) {
    if (!line) continue;
    const columns = line.split("\t");
    const word = normalize(columns[0] ?? "");
    if (!word) continue;

    const category = columns[4] ?? "";
    const frequency = Number(columns[9] ?? 0);
    const isLemma = columns[13] === "1";
    const isSolution =
      isLemma &&
      SOLUTION_CATEGORIES.has(category) &&
      frequency >= MIN_SOLUTION_FREQUENCY &&
      !banned.has(word);
    const previous = words.get(word);

    words.set(word, {
      word,
      length: word.length,
      // Plusieurs entrées homographes peuvent exister : une seule entrée
      // admissible suffit à rendre le mot tirable.
      isSolution: (previous?.isSolution ?? false) || isSolution,
    });
  }

  return [...words.values()].sort((a, b) => a.word.localeCompare(b.word, "fr"));
}

/** SQL idempotent, découpé pour ne pas construire une requête géante au démarrage. */
export function renderDictionarySql(words: readonly DictionaryWord[]): string {
  const statements: string[] = [];
  for (let offset = 0; offset < words.length; offset += BATCH_SIZE) {
    const values = words
      .slice(offset, offset + BATCH_SIZE)
      .map(({ word, length, isSolution }) => `('${word}', ${length}, true, ${isSolution})`)
      .join(",\n");
    statements.push(
      [
        'INSERT INTO "motus_words" ("word", "length", "active", "is_solution") VALUES',
        values,
        'ON CONFLICT ("word") DO UPDATE SET',
        '  "length" = EXCLUDED."length",',
        '  "active" = EXCLUDED."active",',
        '  "is_solution" = EXCLUDED."is_solution";',
      ].join("\n"),
    );
  }
  return statements.join("\n--> statement-breakpoint\n");
}

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Argument requis : ${name}`);
  return value;
}

function updateMigration(migrationPath: string, sql: string, counts: string): void {
  const current = readFileSync(migrationPath, "utf8");
  const before = current.includes(BEGIN_MARKER)
    ? current.slice(0, current.indexOf(BEGIN_MARKER)).trimEnd()
    : current.trimEnd();
  writeFileSync(
    migrationPath,
    `${before}\n--> statement-breakpoint\n${BEGIN_MARKER}\n-- ${counts}\n${sql}\n${END_MARKER}\n`,
  );
}

function main(): void {
  const lexiquePath = argument("--lexique");
  const badWordsPath = argument("--badwords");
  const migrationPath = argument("--migration");
  const archive = readFileSync(lexiquePath);
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== LEXIQUE_SHA256) {
    throw new Error(`Archive Lexique inattendue : ${digest}`);
  }

  const tsv = execFileSync("unzip", ["-p", lexiquePath, "Lexique4/Lexique4.tsv"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const badWords = execFileSync("tar", ["-xOf", badWordsPath, "package/list.txt"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const words = buildDictionary(tsv, badWords);
  const solutions = words.filter((word) => word.isSolution).length;
  updateMigration(
    migrationPath,
    renderDictionarySql(words),
    `${words.length} propositions acceptées, ${solutions} solutions familiales`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
