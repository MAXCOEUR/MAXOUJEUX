import { describe, expect, it } from "vitest";
import { isCheckViolation, isUniqueViolation } from "./pg-errors.js";

describe("reconnaissance des erreurs PostgreSQL", () => {
  it("reconnaît un SQLSTATE exposé directement par le pilote", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isCheckViolation({ code: "23514" })).toBe(true);
  });

  it("reconnaît un SQLSTATE enveloppé par Drizzle ORM", () => {
    const wrapped = new Error("Failed query", {
      cause: new Error("duplicate key"),
    });
    Object.assign(wrapped.cause as Error, { code: "23505" });

    expect(isUniqueViolation(wrapped)).toBe(true);
  });

  it("s'arrête sur une chaîne de causes cyclique", () => {
    const error = new Error("cycle");
    error.cause = error;

    expect(isUniqueViolation(error)).toBe(false);
  });
});
