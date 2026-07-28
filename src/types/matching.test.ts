// ABOUTME: Verifies MATCHING_RESPONSE_SCHEMA is a valid, fully-strict JSON schema.
// ABOUTME: Walks every object level recursively checking additionalProperties/required invariants.
import { describe, expect, it } from "vitest";
import { MATCHING_RESPONSE_SCHEMA } from "./matching";

type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
};

/**
 * Recursively walks a JSON schema and asserts that every object-typed node
 * has additionalProperties: false and a required array covering exactly the
 * keys in properties. Anthropic structured outputs require this at every
 * level or the call is rejected.
 */
function assertStrictObjectSchema(schema: JsonSchema, path: string): void {
  if (schema.type === "object") {
    expect(schema.additionalProperties, `${path}.additionalProperties`).toBe(false);
    const propertyKeys = Object.keys(schema.properties ?? {});
    expect(schema.required, `${path}.required`).toBeDefined();
    expect([...(schema.required ?? [])].sort()).toEqual([...propertyKeys].sort());

    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      assertStrictObjectSchema(childSchema, `${path}.properties.${key}`);
    }
  }

  if (schema.type === "array" && schema.items) {
    assertStrictObjectSchema(schema.items, `${path}.items`);
  }
}

describe("MATCHING_RESPONSE_SCHEMA", () => {
  it("is a valid object schema", () => {
    expect(MATCHING_RESPONSE_SCHEMA.type).toBe("object");
  });

  it("has additionalProperties: false and matching required arrays at every object level", () => {
    assertStrictObjectSchema(MATCHING_RESPONSE_SCHEMA as unknown as JsonSchema, "root");
  });

  it("covers the top-level MatchingResponse fields", () => {
    expect(Object.keys(MATCHING_RESPONSE_SCHEMA.properties).sort()).toEqual(
      ["conversational", "recommendations", "tasteMap"].sort()
    );
  });
});
