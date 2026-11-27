import type { Rules } from "../kernel/index.ts";
import {
  ALIASABLE_FEATURES,
  BUILTIN_DEPARTMENTS,
  TOGGLEABLE_FEATURES,
  WORKSPACE_CONFIG_ID,
  decodeAliasObject,
  stringifyAliasMap,
} from "./domain/config.ts";

function allowedList(values: string[] | undefined, allowed: readonly string[], field: string) {
  if (!values) return undefined;
  if (values.some((value) => !allowed.includes(value))) throw new Error("INVALID_FIELD:" + field);
  return [...new Set(values)];
}

function aliases(raw: string | undefined, allowed: readonly string[], field: string) {
  if (raw === undefined) return undefined;
  const object = decodeAliasObject(raw);
  if (!object) throw new Error("INVALID_FIELD:" + field);

  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(object)) {
    if (!allowed.includes(key) || typeof value !== "string")
      throw new Error("INVALID_FIELD:" + field);
    const alias = value.trim();
    if (alias.length > 40) throw new Error("TOO_LONG:" + field);
    entries.push([key, alias]);
  }
  return stringifyAliasMap(Object.fromEntries(entries)) ?? undefined;
}

function layout(values: string[] | undefined, field: string) {
  if (!values) return undefined;
  if (values.length > 40) throw new Error("TOO_LONG:" + field);
  const trimmed = values.map((value) => value.trim());
  if (trimmed.some((value) => value.length > 60)) throw new Error("TOO_LONG:" + field);
  return [...new Set(trimmed.filter(Boolean))];
}

export const rules: Rules = {
  workspaceConfig: {
    prepare({ data }) {
      return {
        ...data,
        disabledFeatures: allowedList(data.disabledFeatures, TOGGLEABLE_FEATURES, "disabledFeatures"),
        featureAliases: aliases(data.featureAliases, ALIASABLE_FEATURES, "featureAliases"),
        hiddenDepartments: allowedList(data.hiddenDepartments, BUILTIN_DEPARTMENTS, "hiddenDepartments"),
        departmentAliases: aliases(data.departmentAliases, BUILTIN_DEPARTMENTS, "departmentAliases"),
        sidebarFavorites: layout(data.sidebarFavorites, "sidebarFavorites"),
        phoneShortcuts: layout(data.phoneShortcuts, "phoneShortcuts"),
        homeCards: layout(data.homeCards, "homeCards"),
      };
    },
    async check({ id }) {
      if (id !== WORKSPACE_CONFIG_ID) throw new Error("INVALID_WORKSPACE_CONFIG_ID");
    },
  },
};
