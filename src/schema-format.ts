// ABOUTME: Pure JSON-schema pretty-printer for MCP tool parameter display.
// ABOUTME: Kept free of MCP SDK / UI / auth imports for cold-start import slimming.

export function formatSchema(schema: unknown, indent = "  "): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return `${indent}(no schema)`;
  }

  const s = schema as Record<string, unknown>;

  if (
    s.type === "object" &&
    s.properties &&
    typeof s.properties === "object" &&
    !Array.isArray(s.properties)
  ) {
    const props = s.properties as Record<string, unknown>;
    const required = Array.isArray(s.required)
      ? s.required.filter((name): name is string => typeof name === "string")
      : [];

    if (Object.keys(props).length === 0) {
      return `${indent}(no parameters)`;
    }

    const lines: string[] = [];
    for (const [name, propSchema] of Object.entries(props)) {
      lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
    return lines.join("\n");
  }

  const lines = formatNestedSchema(s, indent);
  if (lines.length > 0) {
    return lines.join("\n");
  }

  const typeStr = formatType(s);
  if (typeStr) {
    return `${indent}(${typeStr})`;
  }

  return `${indent}(complex schema)`;
}

function formatProperty(
  name: string,
  schema: unknown,
  required: boolean,
  indent: string,
): string[] {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return [`${indent}${name}${required ? " *required*" : ""}`];
  }

  const s = schema as Record<string, unknown>;
  const parts = [`${indent}${name}`];
  const typeStr = formatType(s);
  if (typeStr) parts.push(`(${typeStr})`);
  if (required) parts.push("*required*");
  appendSchemaAnnotations(parts, s);

  return [parts.join(" "), ...formatNestedSchema(s, `${indent}  `)];
}

function formatNestedSchema(schema: Record<string, unknown>, indent: string): string[] {
  const lines: string[] = [];

  if (Array.isArray(schema.anyOf)) {
    lines.push(...formatVariants("anyOf", schema.anyOf, indent));
  }
  if (Array.isArray(schema.oneOf)) {
    lines.push(...formatVariants("oneOf", schema.oneOf, indent));
  }
  if (schema.items !== undefined) {
    lines.push(...formatProperty("items", schema.items, false, indent));
  }
  if (
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
  ) {
    const required = Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [];
    for (const [name, propSchema] of Object.entries(schema.properties as Record<string, unknown>)) {
      lines.push(...formatProperty(name, propSchema, required.includes(name), indent));
    }
  }

  return lines;
}

function formatVariants(keyword: "anyOf" | "oneOf", variants: unknown[], indent: string): string[] {
  const lines = [`${indent}${keyword}:`];

  for (const variant of variants) {
    if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
      lines.push(`${indent}  - ${JSON.stringify(variant)}`);
      continue;
    }

    const s = variant as Record<string, unknown>;
    const typeStr = formatType(s) || "schema";
    const parts = [`${indent}  - ${typeStr}`];
    appendSchemaAnnotations(parts, s);
    lines.push(parts.join(" "));
    lines.push(...formatNestedSchema(s, `${indent}    `));
  }

  return lines;
}

function formatType(schema: Record<string, unknown>): string {
  if (Object.hasOwn(schema, "const")) {
    return `const ${JSON.stringify(schema.const)}`;
  }

  if (Array.isArray(schema.enum)) {
    return `enum: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`;
  }

  if (Array.isArray(schema.type)) {
    return schema.type.map((type) => String(type)).join(" | ");
  }

  if (schema.type) {
    return String(schema.type);
  }

  if (
    schema.properties &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties)
  ) {
    return "object";
  }

  if (schema.items !== undefined) {
    return "array";
  }

  return "";
}

function appendSchemaAnnotations(parts: string[], schema: Record<string, unknown>): void {
  if (schema.description && typeof schema.description === "string") {
    parts.push(`- ${schema.description}`);
  }

  for (const key of [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "minItems",
    "maxItems",
    "format",
    "pattern",
  ] as const) {
    if (schema[key] !== undefined) {
      parts.push(`[${key}: ${JSON.stringify(schema[key])}]`);
    }
  }

  if (schema.default !== undefined) {
    parts.push(`[default: ${JSON.stringify(schema.default)}]`);
  }
}
