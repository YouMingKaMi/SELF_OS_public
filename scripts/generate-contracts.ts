/**
 * Derives every non-TypeScript artefact from packages/contracts/schema.ts:
 *   packages/contracts/openapi.json                         HTTP contract
 *   apps/ios/CouncilCore/.../Generated/EntitySchema.swift   field metadata + local table layout
 *   apps/ios/CouncilCore/.../Generated/EntityFields.swift   one typed struct per entity
 *   node scripts/generate-contracts.ts          write
 *   node scripts/generate-contracts.ts --check  fail if any file is stale
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { commandSchema, schema } from "../packages/contracts/entities.ts";
import {
  snake,
  type EntitySpec,
  type FieldSpec,
} from "../packages/contracts/fields.ts";

const specs = Object.entries(schema) as [string, EntitySpec][];
const pascal = (name: string) => name[0].toUpperCase() + name.slice(1);
const outputs = new Map<string, string>();

// ---------- OpenAPI ----------
const day = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
function jsonSchema(f: FieldSpec): object {
  switch (f.kind) {
    case "string":
      return { type: "string", maxLength: f.max };
    case "enum":
      return { enum: [...f.values] };
    case "day":
      return day;
    case "month":
      return { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" };
    case "timestamp":
      return { type: "string", format: "date-time" };
    case "money":
      return {
        type: "string",
        pattern: f.signed ? "^-?[0-9]{1,18}$" : "^[0-9]{1,18}$",
        description: "Integer minor units.",
      };
    case "decimal":
      return {
        type: "string",
        pattern: (f.signed ? "^-?" : "^") + "[0-9]{1,18}(\\.[0-9]{1,12})?$",
      };
    case "integer":
      return { type: "integer", minimum: f.min, maximum: f.max };
    case "number":
      return { type: "number", minimum: f.min, maximum: f.max };
    case "boolean":
      return { type: "boolean" };
    case "ref":
      return {
        type: "string",
        format: "uuid",
        description: `Id of a live ${f.target}.`,
      };
    case "strings":
      return {
        type: "array",
        maxItems: 1000,
        items: { type: "string", maxLength: 2000 },
      };
  }
}
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name });
const dataSchemas = Object.fromEntries(
  specs.map(([type, spec]) => [
    pascal(type) + "Data",
    {
      type: "object",
      additionalProperties: false,
      description: `Payload of a ${type} (module: ${spec.module}).`,
      required: Object.entries(spec.fields)
        .filter(([, f]) => f.required)
        .map(([key]) => key),
      properties: Object.fromEntries(
        Object.entries(spec.fields).map(([key, f]) => [key, jsonSchema(f)]),
      ),
    },
  ]),
);
const entity = {
  type: "object",
  additionalProperties: false,
  required: ["id", "type", "version", "data", "deleted", "updatedAt"],
  properties: {
    id: { type: "string", format: "uuid" },
    type: { enum: specs.map(([type]) => type) },
    version: { type: "integer", minimum: 1 },
    data: {
      description: "Shape depends on `type`.",
      anyOf: specs.map(([type]) => ref(pascal(type) + "Data")),
    },
    deleted: { type: "boolean" },
    updatedAt: { type: "string", format: "date-time" },
  },
};
const error = (description: string) => ({
  description,
  content: { "application/json": { schema: ref("Error") } },
});
const openapi = {
  openapi: "3.1.1",
  info: {
    title: "SELF OS — sync API",
    version: "1.0.0",
    description:
      "Generated from packages/contracts/schema.ts; do not edit. One write path, one read path. v1 only gains optional fields. Development identity only: device pairing is not implemented.",
  },
  paths: {
    "/v1/commands": {
      post: {
        operationId: "submitCommand",
        summary:
          "Create, replace or delete one entity. Idempotent per device and operationId.",
        security: [{ devBearer: [] }],
        parameters: [
          {
            name: "x-device-id",
            in: "header",
            required: true,
            schema: { type: "string", minLength: 1, maxLength: 100 },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: ref("Command") } },
        },
        responses: {
          200: {
            description:
              "Accepted, or a conflict carrying the server copy. A conflict is a normal outcome, not an error.",
            content: { "application/json": { schema: ref("Receipt") } },
          },
          400: error(
            "The payload broke a schema or business rule; `error` is CODE or CODE:field.",
          ),
          401: error("Missing or wrong credential."),
          409: error("OPERATION_REUSED or NOT_FOUND."),
        },
      },
    },
    "/v1/changes": {
      get: {
        operationId: "listChanges",
        summary:
          "Entities changed after the cursor, each once at its latest state, in revision order.",
        security: [{ devBearer: [] }],
        parameters: [
          {
            name: "cursor",
            in: "query",
            schema: { type: "string", pattern: "^[0-9]{1,18}$" },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 500 },
          },
        ],
        responses: {
          200: {
            description: "One page. Apply it and store nextCursor atomically.",
            content: { "application/json": { schema: ref("Changes") } },
          },
          401: error("Missing or wrong credential."),
        },
      },
    },
  },
  components: {
    securitySchemes: { devBearer: { type: "http", scheme: "bearer" } },
    schemas: {
      Command: {
        ...commandSchema,
        properties: {
          ...commandSchema.properties,
          entityType: { enum: specs.map(([type]) => type) },
        },
      },
      Entity: entity,
      Receipt: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "entity", "revision"],
            properties: {
              outcome: { const: "accepted" },
              entity: ref("Entity"),
              revision: { type: "string" },
            },
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["outcome", "current"],
            properties: {
              outcome: { const: "conflict" },
              current: { anyOf: [ref("Entity"), { type: "null" }] },
            },
          },
        ],
      },
      Changes: {
        type: "object",
        additionalProperties: false,
        required: ["changes", "nextCursor", "hasMore"],
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["revision", "entity"],
              properties: {
                revision: { type: "string" },
                entity: ref("Entity"),
              },
            },
          },
          nextCursor: { type: "string" },
          hasMore: { type: "boolean" },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: { error: { type: "string" } },
      },
      ...dataSchemas,
    },
  },
};
outputs.set(
  "packages/contracts/openapi.json",
  JSON.stringify(openapi, null, 2) + "\n",
);

// ---------- Swift ----------
const swiftFolder = "apps/ios/CouncilCore/Sources/CouncilCore/Generated/";
const header =
  "// Generated from packages/contracts/schema.ts by scripts/generate-contracts.ts. Do not edit.\n";
const quote = (value: string) => JSON.stringify(value);
/** SQLite storage class for the local copy; money fits 64-bit integers, decimals stay text. */
const sqlite = (f: FieldSpec) =>
  f.kind === "money" || f.kind === "integer" || f.kind === "boolean"
    ? "INTEGER"
    : f.kind === "number"
      ? "REAL"
      : "TEXT";
const swiftKind = (f: FieldSpec) => (f.kind === "enum" ? "choice" : f.kind);

let schemaSwift =
  header +
  `import Foundation

public enum FieldKind: String, Sendable {
  case string, choice, day, month, timestamp, money, decimal, integer, number, boolean, ref, strings
}
public struct FieldSpec: Sendable {
  public let name: String
  /** Column in the local table. */
  public let column: String
  public let kind: FieldKind
  public let required: Bool
  /** SQLite storage class of the column. */
  public let storage: String
  public var values: [String] = []
  public var target: String? = nil
  public var minimum: Double? = nil
  public var maximum: Double? = nil
}
public struct EntitySpec: Sendable {
  public let type: String
  public let module: String
  public let table: String
  public let fields: [FieldSpec]
  public func field(_ name: String) -> FieldSpec? { fields.first { $0.name == name } }
}
public enum EntityType: String, Codable, Sendable, CaseIterable {
${specs.map(([type]) => `  case ${type === "repeat" ? "`repeat`" : type}`).join("\n")}
}
public enum EntitySchema {
  public static let all: [EntitySpec] = [
`;
for (const [type, spec] of specs) {
  schemaSwift += `    EntitySpec(type: ${quote(type)}, module: ${quote(spec.module)}, table: ${quote(spec.table)}, fields: [\n`;
  for (const [name, f] of Object.entries(spec.fields)) {
    const extra = [
      f.kind === "enum" ? `values: [${f.values.map(quote).join(", ")}]` : "",
      f.kind === "ref" ? `target: ${quote(f.target)}` : "",
      f.kind === "integer" || f.kind === "number"
        ? `minimum: ${f.min}, maximum: ${f.max}`
        : "",
    ]
      .filter(Boolean)
      .map((text) => ", " + text)
      .join("");
    schemaSwift += `      FieldSpec(name: ${quote(name)}, column: ${quote(snake(name))}, kind: .${swiftKind(f)}, required: ${f.required}, storage: ${quote(sqlite(f))}${extra}),\n`;
  }
  schemaSwift += "    ]),\n";
}
schemaSwift += `  ]
  public static let byType: [String: EntitySpec] = Dictionary(
    uniqueKeysWithValues: all.map { ($0.type, $0) })
}
`;
outputs.set(swiftFolder + "EntitySchema.swift", schemaSwift);

const swiftType = (f: FieldSpec) =>
  f.kind === "boolean"
    ? "Bool"
    : f.kind === "integer"
      ? "Int"
      : f.kind === "number"
        ? "Double"
        : f.kind === "strings"
          ? "[String]"
          : "String";
const reader = (name: string, f: FieldSpec) => {
  const value = `record.data[${quote(name)}]`;
  return f.kind === "boolean"
    ? `${value}?.boolValue`
    : f.kind === "integer"
      ? `${value}?.numberValue.map { Int($0) }`
      : f.kind === "number"
        ? `${value}?.numberValue`
        : f.kind === "strings"
          ? `${value}?.stringsValue`
          : `${value}?.stringValue`;
};
const writer = (name: string, f: FieldSpec) =>
  f.kind === "boolean"
    ? `.bool(${name})`
    : f.kind === "integer"
      ? `.number(Double(${name}))`
      : f.kind === "number"
        ? `.number(${name})`
        : f.kind === "strings"
          ? `.array(${name}.map(JSONValue.string))`
          : `.string(${name})`;
const safe = (name: string) => (name === "repeat" ? "`repeat`" : name);
let fieldsSwift =
  header +
  `import Foundation

/// A typed view of one entity's payload. \`init?(_:)\` fails when a required field is missing.
public protocol EntityFields: Sendable, Equatable {
  static var entityType: String { get }
  init?(_ record: Record)
  var data: [String: JSONValue] { get }
}
`;
for (const [type, spec] of specs) {
  const fields = Object.entries(spec.fields);
  fieldsSwift += `\npublic struct ${pascal(type)}Fields: EntityFields {\n  public static let entityType = ${quote(type)}\n`;
  for (const [name, f] of fields)
    fieldsSwift += `  public var ${safe(name)}: ${swiftType(f)}${f.required ? "" : "?"}\n`;
  fieldsSwift += `  public init(${fields
    .map(
      ([name, f]) =>
        `${safe(name)}: ${swiftType(f)}${f.required ? "" : "? = nil"}`,
    )
    .join(
      ", ",
    )}) {\n${fields.map(([name]) => `    self.${name} = ${safe(name)}`).join("\n")}\n  }\n`;
  const required = fields.filter(([, f]) => f.required);
  fieldsSwift += `  public init?(_ record: Record) {\n    guard record.type == Self.entityType${required
    .map(([name, f]) => `,\n      let ${safe(name)} = ${reader(name, f)}`)
    .join("")}\n    else { return nil }\n`;
  for (const [name, f] of fields)
    fieldsSwift += f.required
      ? `    self.${name} = ${safe(name)}\n`
      : `    self.${name} = ${reader(name, f)}\n`;
  fieldsSwift += `  }\n  public var data: [String: JSONValue] {\n    var data: [String: JSONValue] = [:]\n`;
  for (const [name, f] of fields)
    fieldsSwift += f.required
      ? `    data[${quote(name)}] = ${writer(safe(name), f)}\n`
      : `    if let ${safe(name)} { data[${quote(name)}] = ${writer(safe(name), f)} }\n`;
  fieldsSwift += "    return data\n  }\n}\n";
}
outputs.set(swiftFolder + "EntityFields.swift", fieldsSwift);

// Protocol envelopes, mirroring packages/contracts/entities.ts.
outputs.set(
  swiftFolder + "Wire.swift",
  header +
    `import Foundation

/// One entity as the server confirmed it, or as this device currently projects it.
public struct Record: Codable, Sendable, Identifiable, Equatable {
  public var id: String
  public var type: String
  public var version: Int
  public var data: [String: JSONValue]
  public var deleted: Bool
  public var updatedAt: String
  public init(
    id: String, type: String, version: Int, data: [String: JSONValue], deleted: Bool,
    updatedAt: String
  ) {
    self.id = id
    self.type = type
    self.version = version
    self.data = data
    self.deleted = deleted
    self.updatedAt = updatedAt
  }
}
/// POST /v1/commands. \`baseVersion\` is the version this device edited; 0 creates.
public struct Command: Codable, Sendable, Equatable {
  public var operationId: String
  public var entityId: String
  public var entityType: String
  public var baseVersion: Int
  public var action: String
  public var data: [String: JSONValue]?
  public var occurredAt: String
  public init(
    operationId: String, entityId: String, entityType: String, baseVersion: Int, action: String,
    data: [String: JSONValue]?, occurredAt: String
  ) {
    self.operationId = operationId
    self.entityId = entityId
    self.entityType = entityType
    self.baseVersion = baseVersion
    self.action = action
    self.data = data
    self.occurredAt = occurredAt
  }
}
public struct Receipt: Codable, Sendable {
  public var outcome: String
  public var entity: Record?
  public var current: Record?
  public var revision: String?
}
public struct Changes: Codable, Sendable {
  public struct Change: Codable, Sendable {
    public var revision: String
    public var entity: Record
  }
  public var changes: [Change]
  public var nextCursor: String
  public var hasMore: Bool
}
`,
);

// ---------- write or check ----------
const check = process.argv.includes("--check");
for (const [path, text] of outputs) {
  const file = new URL("../" + path, import.meta.url);
  if (check) {
    if (!existsSync(file) || readFileSync(file, "utf8") !== text)
      throw new Error(`${path} is stale. Run: npm run contracts:generate`);
  } else {
    mkdirSync(new URL(".", file), { recursive: true });
    writeFileSync(file, text);
  }
}
console.log(
  (check ? "Up to date: " : "Generated: ") + [...outputs.keys()].join(", "),
);
