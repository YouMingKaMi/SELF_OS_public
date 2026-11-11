import type {
  EntitySpec,
  FieldSpec,
} from "../../../packages/contracts/fields.ts";

type Raw = Record<string, unknown>;
type Clean = Record<string, string | number | boolean | string[]>;

export function validDay(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "1900-01-01" ||
    value > "9999-12-31"
  )
    return false;
  const date = new Date(value + "T00:00:00Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const fail = (code: string, key: string): never => {
  throw new Error(code + ":" + key);
};

function field(key: string, f: FieldSpec, value: unknown) {
  switch (f.kind) {
    case "string":
      if (typeof value !== "string") return fail("INVALID_FIELD", key);
      if (f.required && !value.trim()) return fail("REQUIRED", key);
      if (value.length > f.max) return fail("TOO_LONG", key);
      return value;
    case "enum":
      if (typeof value !== "string" || !f.values.includes(value))
        return fail("INVALID_FIELD", key);
      return value;
    case "day":
      if (typeof value !== "string" || !validDay(value))
        return fail("INVALID_DATE", key);
      return value;
    case "month":
      if (typeof value !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value))
        return fail("INVALID_DATE", key);
      return value;
    case "timestamp": {
      // An instant must carry its offset; the stored form is always UTC milliseconds.
      if (
        typeof value !== "string" ||
        !/T.*(Z|[+-]\d{2}:\d{2})$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        return fail("INVALID_TIME", key);
      return new Date(value).toISOString();
    }
    case "money":
      if (
        typeof value !== "string" ||
        !(f.signed ? /^-?\d{1,18}$/ : /^\d{1,18}$/).test(value)
      )
        return fail("INVALID_AMOUNT", key);
      return value;
    case "decimal":
      if (
        typeof value !== "string" ||
        !(
          f.signed ? /^-?\d{1,18}(\.\d{1,12})?$/ : /^\d{1,18}(\.\d{1,12})?$/
        ).test(value)
      )
        return fail("INVALID_DECIMAL", key);
      return value;
    case "integer":
    case "number":
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (f.kind === "integer" && !Number.isInteger(value)) ||
        value < f.min ||
        value > f.max
      )
        return fail("INVALID_NUMBER", key);
      return value;
    case "boolean":
      if (typeof value !== "boolean") return fail("INVALID_FIELD", key);
      return value;
    case "ref":
      if (
        typeof value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value,
        )
      )
        return fail("INVALID_REFERENCE", key);
      return value.toLowerCase();
    case "strings":
      if (
        !Array.isArray(value) ||
        value.length > 1000 ||
        value.some((v) => typeof v !== "string" || v.length > 2000)
      )
        return fail("INVALID_FIELD", key);
      return value as string[];
  }
}

/**
 * Check a payload against its entity spec and return the canonical form.
 * `null`, `undefined` and (outside free text) `""` all mean "absent".
 * Pure: the same input always yields the same output or the same coded error.
 */
export function normalize(spec: EntitySpec, raw: Raw): Clean {
  for (const key of Object.keys(raw))
    if (!spec.fields[key]) fail("UNKNOWN_FIELD", key);
  const clean: Clean = {};
  for (const [key, f] of Object.entries(spec.fields)) {
    const value = raw[key];
    const absent =
      value === undefined ||
      value === null ||
      (value === "" && f.kind !== "string");
    if (absent) {
      if (f.required) fail("REQUIRED", key);
      continue;
    }
    clean[key] = field(key, f, value);
  }
  return clean;
}
