/**
 * Field vocabulary for the single entity schema. Every other representation
 * (TypeScript types, wire validation, PostgreSQL DDL, SQLite DDL, Swift structs,
 * OpenAPI) is derived from these specs; nothing else may describe a field.
 */
export type FieldSpec =
  | { kind: "string"; required: boolean; max: number }
  | { kind: "enum"; required: boolean; values: readonly string[] }
  | { kind: "day"; required: boolean }
  | { kind: "month"; required: boolean }
  | { kind: "timestamp"; required: boolean }
  | { kind: "money"; required: boolean; signed: boolean }
  | { kind: "decimal"; required: boolean; signed: boolean }
  | { kind: "integer"; required: boolean; min: number; max: number }
  | { kind: "number"; required: boolean; min: number; max: number }
  | { kind: "boolean"; required: boolean }
  | { kind: "ref"; required: boolean; target: string }
  | { kind: "strings"; required: boolean };

export type EntitySpec = {
  /** Owning business module; only this module may attach rules to the type. */
  module: string;
  table: string;
  fields: Record<string, FieldSpec>;
};

// NoInfer: the flag is decided by the argument alone, never by the surrounding expected type.
type Req<R extends boolean> = { required: NoInfer<R> };
const optional = { required: false } as const;

/** Short text. `required` also rejects whitespace-only values. */
export const text = <R extends boolean = false>(
  required: R = false as R,
  max = 500,
) => ({ kind: "string", max, required }) as const satisfies FieldSpec & Req<R>;
export const choice = <
  const V extends readonly string[],
  R extends boolean = true,
>(
  values: V,
  required: R = true as R,
) =>
  ({ kind: "enum", values, required }) as { kind: "enum"; values: V } & Req<R>;
/** Business-calendar day, `YYYY-MM-DD`. */
export const day = <R extends boolean = false>(required: R = false as R) =>
  ({ kind: "day", required }) as const satisfies FieldSpec & Req<R>;
/** Business-calendar month, `YYYY-MM`. */
export const month = <R extends boolean = false>(required: R = false as R) =>
  ({ kind: "month", required }) as const satisfies FieldSpec & Req<R>;
/** Instant with explicit offset; the server normalises to UTC milliseconds. */
export const timestamp = <R extends boolean = false>(
  required: R = false as R,
) => ({ kind: "timestamp", required }) as const satisfies FieldSpec & Req<R>;
/** Integer minor units as a decimal string. Never a float. */
export const money = <R extends boolean = false>(
  required: R = false as R,
  signed = false,
) =>
  ({ kind: "money", signed, required }) as const satisfies FieldSpec & Req<R>;
/** Exact decimal string (quantity, price, rate). Never a float. */
export const decimal = <R extends boolean = false>(
  required: R = false as R,
  signed = false,
) =>
  ({ kind: "decimal", signed, required }) as const satisfies FieldSpec & Req<R>;
export const integer = (min = 0, max = 2147483647) =>
  ({ kind: "integer", min, max, ...optional }) as const satisfies FieldSpec;
export const number = (min = 0, max = 1e12) =>
  ({ kind: "number", min, max, ...optional }) as const satisfies FieldSpec;
export const flag = {
  kind: "boolean",
  ...optional,
} as const satisfies FieldSpec;
export const ref = <const T extends string, R extends boolean = false>(
  target: T,
  required: R = false as R,
) => ({ kind: "ref", target, required }) as { kind: "ref"; target: T } & Req<R>;
export const strings = {
  kind: "strings",
  ...optional,
} as const satisfies FieldSpec;

export const entity = <const F extends Record<string, FieldSpec>>(
  module: string,
  table: string,
  fields: F,
) => ({ module, table, fields });

type ValueOf<F> = F extends { kind: "enum"; values: readonly (infer V)[] }
  ? V
  : F extends { kind: "boolean" }
    ? boolean
    : F extends { kind: "integer" | "number" }
      ? number
      : F extends { kind: "strings" }
        ? string[]
        : string;
type Flatten<T> = { [K in keyof T]: T[K] };
/** Payload type of an entity, inferred from its field specs. */
export type DataOf<F> = Flatten<
  {
    -readonly [
      K in keyof F as F[K] extends { required: true } ? K : never
    ]: ValueOf<F[K]>;
  } & {
    -readonly [
      K in keyof F as F[K] extends { required: true } ? never : K
    ]?: ValueOf<F[K]>;
  }
>;

export const snake = (name: string) =>
  name.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
