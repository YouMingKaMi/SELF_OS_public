import { useMemo } from "react";
import {
  ALIASABLE_FEATURES,
  BUILTIN_DEPARTMENTS,
  TOGGLEABLE_FEATURES,
  WORKSPACE_CONFIG_ID,
  WORKSPACE_PRESETS,
  detectWorkspacePreset,
  isFeatureEnabled,
  parseAliasMap,
  stringifyAliasMap,
  type WorkspacePreset,
} from "../../../../modules/workspace/index.ts";
import {
  put,
  saveEdit,
  useEntities,
  type Data,
  type Entity,
} from "../data/entities.ts";
import { feature, type FeatureKey } from "../navigation.ts";

export {
  ALIASABLE_FEATURES,
  BUILTIN_DEPARTMENTS,
  TOGGLEABLE_FEATURES,
  WORKSPACE_CONFIG_ID,
  WORKSPACE_PRESETS,
  type WorkspacePreset,
};

export interface PresetMeta {
  id: Exclude<WorkspacePreset, "custom">;
  title: string;
  badge: string;
  description: string;
}

export const PRESET_LIST: readonly PresetMeta[] = [
  {
    id: "council",
    title: "个人内阁",
    badge: "全部 19 模块",
    description: "作者完整配置：开启全部模块与四大部门，零删减。",
  },
  {
    id: "standard",
    title: "常规生活",
    badge: "精选 9 模块",
    description: "任务、习惯、花销、编年史、想法、资料笔记、重要日子、储物箱、成就。",
  },
  {
    id: "minimal",
    title: "极简起步",
    badge: "核心 5 模块",
    description: "只留任务、习惯、花销、编年史、资料笔记，开箱最轻盈。",
  },
];

export function useWorkspaceConfig() {
  const { entities } = useEntities("workspaceConfig");
  const record: Entity<"workspaceConfig"> | undefined = useMemo(
    () =>
      entities.find((e) => e.id === WORKSPACE_CONFIG_ID) ?? entities[0],
    [entities],
  );

  const disabledFeatures = useMemo(
    () => (record?.data.disabledFeatures ?? []) as string[],
    [record],
  );
  const hiddenDepartments = useMemo(
    () => (record?.data.hiddenDepartments ?? []) as string[],
    [record],
  );
  const featureAliases = useMemo(
    () => parseAliasMap(record?.data.featureAliases),
    [record],
  );
  const departmentAliases = useMemo(
    () => parseAliasMap(record?.data.departmentAliases),
    [record],
  );
  const preset: WorkspacePreset = useMemo(
    () => detectWorkspacePreset(disabledFeatures, hiddenDepartments),
    [disabledFeatures, hiddenDepartments],
  );

  async function commit(nextData: Data) {
    if (!record) {
      await put("workspaceConfig", nextData, { id: WORKSPACE_CONFIG_ID });
    } else {
      await saveEdit("workspaceConfig", record.id, record.data, nextData);
    }
  }

  function currentBase(): Data {
    return record ? { ...record.data } : {};
  }

  async function applyPreset(nextPreset: Exclude<WorkspacePreset, "custom">) {
    const def = WORKSPACE_PRESETS[nextPreset];
    const next: Data = {
      ...currentBase(),
      preset: nextPreset,
      disabledFeatures: [...def.disabledFeatures],
      hiddenDepartments: [...def.hiddenDepartments],
    };
    await commit(next);
  }

  async function toggleFeature(key: string) {
    const set = new Set(disabledFeatures);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    const nextDisabled = [...set];
    const nextPreset = detectWorkspacePreset(nextDisabled, hiddenDepartments);
    await commit({
      ...currentBase(),
      preset: nextPreset,
      disabledFeatures: nextDisabled,
    });
  }

  async function setFeatureAlias(key: string, rawAlias: string) {
    const nextMap = { ...featureAliases };
    const clean = rawAlias.trim().slice(0, 40);
    if (!clean || clean === feature(key).name) {
      delete nextMap[key];
    } else {
      nextMap[key] = clean;
    }
    const serialized = stringifyAliasMap(nextMap);
    const next: Data = { ...currentBase() };
    if (serialized) next.featureAliases = serialized;
    else next.featureAliases = null;
    await commit(next);
  }

  async function toggleDepartment(name: string) {
    const set = new Set(hiddenDepartments);
    if (set.has(name)) set.delete(name);
    else set.add(name);
    const nextHidden = [...set];
    const nextPreset = detectWorkspacePreset(disabledFeatures, nextHidden);
    await commit({
      ...currentBase(),
      preset: nextPreset,
      hiddenDepartments: nextHidden,
    });
  }

  async function setDepartmentAlias(name: string, rawAlias: string) {
    const nextMap = { ...departmentAliases };
    const clean = rawAlias.trim().slice(0, 40);
    if (!clean || clean === name) {
      delete nextMap[name];
    } else {
      nextMap[name] = clean;
    }
    const serialized = stringifyAliasMap(nextMap);
    const next: Data = { ...currentBase() };
    if (serialized) next.departmentAliases = serialized;
    else next.departmentAliases = null;
    await commit(next);
  }

  async function resetAllAliases() {
    await commit({
      ...currentBase(),
      featureAliases: null,
      departmentAliases: null,
    });
  }

  function exportConfigJson(): string {
    return JSON.stringify(
      {
        preset,
        disabledFeatures,
        featureAliases,
        hiddenDepartments,
        departmentAliases,
      },
      null,
      2,
    );
  }

  async function importConfigJson(
    raw: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: "配置格式必须是 JSON 对象。" };
      }
      const nextDisabled = Array.isArray(parsed.disabledFeatures)
        ? parsed.disabledFeatures.filter(
            (v): v is string =>
              typeof v === "string" &&
              (TOGGLEABLE_FEATURES as readonly string[]).includes(v),
          )
        : disabledFeatures;
      const nextHidden = Array.isArray(parsed.hiddenDepartments)
        ? parsed.hiddenDepartments.filter(
            (v): v is string =>
              typeof v === "string" &&
              (BUILTIN_DEPARTMENTS as readonly string[]).includes(v),
          )
        : hiddenDepartments;
      const rawFA =
        parsed.featureAliases &&
        typeof parsed.featureAliases === "object" &&
        !Array.isArray(parsed.featureAliases)
          ? (parsed.featureAliases as Record<string, unknown>)
          : null;
      const rawDA =
        parsed.departmentAliases &&
        typeof parsed.departmentAliases === "object" &&
        !Array.isArray(parsed.departmentAliases)
          ? (parsed.departmentAliases as Record<string, unknown>)
          : null;

      const cleanFA: Record<string, string> = {};
      if (rawFA) {
        for (const [k, v] of Object.entries(rawFA)) {
          if (
            (ALIASABLE_FEATURES as readonly string[]).includes(k) &&
            typeof v === "string" &&
            v.trim()
          ) {
            cleanFA[k] = v.trim().slice(0, 40);
          }
        }
      }
      const cleanDA: Record<string, string> = {};
      if (rawDA) {
        for (const [k, v] of Object.entries(rawDA)) {
          if (
            (BUILTIN_DEPARTMENTS as readonly string[]).includes(k) &&
            typeof v === "string" &&
            v.trim()
          ) {
            cleanDA[k] = v.trim().slice(0, 40);
          }
        }
      }

      const faStr = rawFA ? stringifyAliasMap(cleanFA) : record?.data.featureAliases ?? null;
      const daStr = rawDA ? stringifyAliasMap(cleanDA) : record?.data.departmentAliases ?? null;
      const nextPreset = detectWorkspacePreset(nextDisabled, nextHidden);
      await commit({
        ...currentBase(),
        preset: nextPreset,
        disabledFeatures: [...new Set(nextDisabled)],
        hiddenDepartments: [...new Set(nextHidden)],
        featureAliases: faStr,
        departmentAliases: daStr,
      });
      return { ok: true };
    } catch {
      return { ok: false, error: "JSON 解析失败，请检查粘贴内容。" };
    }
  }

  return {
    record,
    preset,
    disabledFeatures,
    hiddenDepartments,
    featureAliases,
    departmentAliases,
    isEnabled: (key: string) => isFeatureEnabled(key, disabledFeatures),
    labelOf: (key: FeatureKey) => featureAliases[key] || feature(key).name,
    departmentLabel: (id: string) => departmentAliases[id] || id,
    isDepartmentVisible: (id: string) => !hiddenDepartments.includes(id),
    applyPreset,
    toggleFeature,
    setFeatureAlias,
    toggleDepartment,
    setDepartmentAlias,
    resetAllAliases,
    exportConfigJson,
    importConfigJson,
  };
}
