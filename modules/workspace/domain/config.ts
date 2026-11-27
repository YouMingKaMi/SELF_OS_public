import type { EntityData } from "../../../packages/contracts/schema.ts";

export const WORKSPACE_CONFIG_ID = "c0000000-0000-4000-8000-000000000001";

export const TOGGLEABLE_FEATURES = [
  "practice", "tasks", "achievements", "habits", "ideas", "reading", "checklists",
  "thoughts", "expenses", "treasury", "freedom", "chronicle", "memoir", "storage",
  "raw", "monthly", "metrics", "days", "notes",
] as const;

const aliasableCore = ["home", "departments", "discover"] as const;
const coreFeatures = new Set<string>([...aliasableCore, "settings"]);
export const ALIASABLE_FEATURES = [...aliasableCore, ...TOGGLEABLE_FEATURES] as const;
export const BUILTIN_DEPARTMENTS = ["执行部", "财政部", "档案库", "中科院"] as const;

export type WorkspacePreset = NonNullable<EntityData<"workspaceConfig">["preset"]>;

export const WORKSPACE_PRESETS = {
  council: { disabledFeatures: [], hiddenDepartments: [] },
  standard: {
    disabledFeatures: [
      "practice", "reading", "checklists", "thoughts", "treasury", "freedom",
      "memoir", "raw", "monthly", "metrics",
    ],
    hiddenDepartments: [],
  },
  minimal: {
    disabledFeatures: [
      "practice", "achievements", "ideas", "reading", "checklists", "thoughts",
      "treasury", "freedom", "memoir", "storage", "raw", "monthly", "metrics", "days",
    ],
    hiddenDepartments: [],
  },
} as const satisfies Record<Exclude<WorkspacePreset, "custom">, {
  disabledFeatures: readonly string[];
  hiddenDepartments: readonly string[];
}>;

// Under Unicode matching, this range only catches unpaired UTF-16 surrogates.
const loneSurrogate = /[\uD800-\uDFFF]/u;

export function decodeAliasObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw, (key: string, entry: unknown) => {
      if (loneSurrogate.test(key) || (typeof entry === "string" && loneSurrogate.test(entry)))
        throw new Error("Invalid Unicode in alias JSON");
      return entry;
    });
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseAliasMap(raw?: string | null): Record<string, string> {
  const object = raw == null ? null : decodeAliasObject(raw);
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(object ?? {})) {
    if (typeof value !== "string") continue;
    const alias = value.trim();
    if (alias) entries.push([key, alias]);
  }
  return Object.fromEntries(entries);
}

export function stringifyAliasMap(map: Readonly<Record<string, string>>): string | null {
  const pairs: string[] = [];
  for (const key of Object.keys(map).sort()) {
    const alias = map[key].trim();
    if (alias) pairs.push(JSON.stringify(key) + ":" + JSON.stringify(alias));
  }
  return pairs.length ? "{" + pairs.join(",") + "}" : null;
}

function matches(values: ReadonlySet<string>, expected: readonly string[]): boolean {
  return values.size === expected.length && expected.every((value) => values.has(value));
}

export function detectWorkspacePreset(
  disabledFeatures?: readonly string[] | null,
  hiddenDepartments?: readonly string[] | null,
): WorkspacePreset {
  const disabled = new Set(disabledFeatures);
  const hidden = new Set(hiddenDepartments);
  for (const name of ["council", "standard", "minimal"] as const) {
    const preset = WORKSPACE_PRESETS[name];
    if (matches(disabled, preset.disabledFeatures) && matches(hidden, preset.hiddenDepartments))
      return name;
  }
  return "custom";
}

export function isFeatureEnabled(key: string, disabledFeatures?: readonly string[] | null): boolean {
  return coreFeatures.has(key) || !disabledFeatures?.includes(key);
}
