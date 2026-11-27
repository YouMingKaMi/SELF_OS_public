import { timeSummary } from "../../../../modules/practice/index.ts";
import React, { useEffect, useMemo, useState } from "react";
import "./workspace.css";
import { Icon } from "../ui/Icon.tsx";
import {
  features,
  feature,
  type FeatureKey,
  type Navigate,
} from "../navigation.ts";
import {
  useEntities,
  useEverything,
  useDatedEntities,
  usePending,
  useSyncStatus,
  put,
  settle,
  remove,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import {
  readWorkspaceOverview,
  subscribeWorkspaceOverview,
  writeWorkspaceExport,
  type WorkspaceOverview,
} from "../data/export.ts";
import { downloadFile } from "../ui/download.ts";
import {
  isAndroidApp,
  openAndroidEndpointSettings,
} from "../ui/android-bridge.ts";
import {
  Heading,
  Panel,
  Empty,
  Stats,
  RecordForm,
  Month,
  monthNow,
  today,
  str,
  num,
  arr,
  perform,
  usePreference,
} from "../ui/shared.tsx";
import { useTaskSummary } from "./Home.tsx";
import { money, net } from "./finance-model.ts";
import { sessionSeconds, duration } from "./PracticeTimer.tsx";
import {
  BUILTIN_DEPARTMENTS,
  PRESET_LIST,
  TOGGLEABLE_FEATURES,
  useWorkspaceConfig,
} from "./workspace-config.ts";
const departmentMarks: Record<string, string> = {
  执行部: "dept-exec",
  财政部: "dept-finance",
  档案库: "dept-archive",
  中科院: "dept-academy",
};
export function Departments({ navigate }: { navigate: Navigate }) {
  const { entities } = useEntities(
    "department",
    "domain",
    "activity",
    "document",
  );
  const [tab, setTab] = useState("common");
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [common, setCommon] = usePreference<string[]>("common-departments", [
    "中科院",
    "执行部",
    "财政部",
    "档案库",
  ]);
  const [form, setForm] = useState(false);
  const ws = useWorkspaceConfig();
  const defaults = [...BUILTIN_DEPARTMENTS];
  const custom = entities.filter((e) => e.type === "department");
  const all = [
    ...defaults
      .filter((name) => ws.isDepartmentVisible(name))
      .map((name) => ({
        id: name,
        rawName: name,
        name: ws.departmentLabel(name),
        keys: features
          .filter((f) => f.department === name && ws.isEnabled(f.key))
          .map((f) => f.key),
      })),
    ...custom.map((e) => ({
      id: e.id,
      rawName: str(e, "name"),
      name: str(e, "name"),
      keys: (arr(e, "features") as FeatureKey[]).filter((k) => ws.isEnabled(k)),
    })),
  ];
  const current = all.find((e) => e.id === selected);
  return (
    <>
      <Heading
        eyebrow="YOUR WORKSPACES"
        title={current ? current.name : ws.labelOf("departments")}
      >
        <button onClick={() => navigate("settings")}>定制模块</button>
        <button onClick={() => setForm(true)}>＋ 创建部门</button>
        {current && <button onClick={() => setSelected("")}>返回部门</button>}
      </Heading>
      {current ? (
        <>
          <div className="department-grid">
            {current.keys.map((key) => (
              <button
                className="department-card"
                key={key}
                onClick={() => navigate(key)}
              >
                <span>
                  <Icon name={key} size={26} />
                </span>
                <h2>{ws.labelOf(key)}</h2>
                <small>进入功能 ↗</small>
              </button>
            ))}
          </div>
          {current.rawName === "中科院" && (
            <Panel title="领域与资料">
              <div className="department-grid">
                {entities
                  .filter((e) => e.type === "domain")
                  .map((domain) => (
                    <section className="domain-card" key={domain.id}>
                      <h3>{str(domain, "name")}</h3>
                      <small>
                        {
                          entities.filter(
                            (e) =>
                              e.type === "document" &&
                              e.data.domainId === domain.id,
                          ).length
                        }{" "}
                        篇资料 ·{" "}
                        {
                          entities.filter(
                            (e) =>
                              e.type === "activity" &&
                              e.data.domainId === domain.id,
                          ).length
                        }{" "}
                        个子领域
                      </small>
                      <div className="form-actions">
                        <button
                          onClick={() => {
                            localStorage.setItem(
                              "pc-next-practice-domain",
                              JSON.stringify(domain.id),
                            );
                            navigate("practice");
                          }}
                        >
                          领域推进 ↗
                        </button>
                        <button onClick={() => navigate("notes")}>
                          资料笔记 ↗
                        </button>
                      </div>
                    </section>
                  ))}
              </div>
            </Panel>
          )}
        </>
      ) : (
        <>
          <div className="section-toolbar">
            <div className="segmented">
              <button
                className={tab === "common" ? "active" : ""}
                onClick={() => setTab("common")}
              >
                常用部门 {common.length}
              </button>
              <button
                className={tab === "all" ? "active" : ""}
                onClick={() => setTab("all")}
              >
                全部部门 {all.length}
              </button>
            </div>
            <input
              aria-label="搜索部门"
              placeholder="搜索部门…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="department-grid dept-grid">
            {all
              .filter(
                (e) =>
                  (tab === "all" || common.includes(e.id)) &&
                  e.name.includes(search),
              )
              .map((d) => (
                <section className="dept-card" key={d.id}>
                  <header>
                    <button className="dept-head" onClick={() => setSelected(d.id)}>
                      <span className="dept-mark">
                        {departmentMarks[d.rawName] ? (
                          <Icon name={departmentMarks[d.rawName]} size={20} />
                        ) : (
                          <b>{d.name.slice(0, 1)}</b>
                        )}
                      </span>
                      <span className="dept-title">
                        <strong>{d.name}</strong>
                        <small>{d.keys.length} 个功能</small>
                      </span>
                    </button>
                    <span className="dept-actions">
                      <button
                        className={"dept-pin" + (common.includes(d.id) ? " on" : "")}
                        title={common.includes(d.id) ? "移出常用" : "加入常用"}
                        aria-label={common.includes(d.id) ? "移出常用" : "加入常用"}
                        onClick={() =>
                          setCommon(common.includes(d.id) ? common.filter((id) => id !== d.id) : [...common, d.id])
                        }
                      >
                        {common.includes(d.id) ? "★" : "☆"}
                      </button>
                      {!defaults.includes(d.id as (typeof BUILTIN_DEPARTMENTS)[number]) && (
                        <button
                          className="dept-pin"
                          title="移除部门"
                          aria-label="移除部门"
                          onClick={() => {
                            const entity = custom.find((e) => e.id === d.id);
                            if (entity) perform(remove(entity));
                          }}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  </header>
                  <div className="dept-features">
                    {d.keys.map((key) => (
                      <button key={key} onClick={() => navigate(key)}>
                        <Icon name={key} size={13} />
                        {ws.labelOf(key)}
                      </button>
                    ))}
                    {!d.keys.length && <small>还没有功能</small>}
                  </div>
                </section>
              ))}
          </div>
        </>
      )}
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>新部门</h2>
              <button onClick={() => setForm(false)}>×</button>
            </header>
            <RecordForm
              type="department"
              defaults={{ name: "", features: [] }}
              fields={[
                { key: "name", label: "名称", required: true },
                {
                  key: "features",
                  label: "功能 key（每行一个，如 notes、practice）",
                  type: "lines",
                },
              ]}
              onSaved={() => setForm(false)}
              onCancel={() => setForm(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}
const typeFeature: Partial<Record<Entity["type"], FeatureKey>> = {
  document: "notes",
  journal: "chronicle",
  idea: "ideas",
  readingItem: "reading",
  domain: "practice",
  activity: "practice",
  problem: "practice",
  solution: "practice",
  progress: "practice",
  session: "practice",
  habit: "habits",
  habitLog: "habits",
  expense: "expenses",
  wallet: "treasury",
  metric: "metrics",
  metricLog: "metrics",
  importantDay: "days",
  checklist: "checklists",
  achievement: "achievements",
  memoir: "memoir",
  storageBox: "storage",
  storageItem: "storage",
};
const kindName: Record<string, string> = {
  document: "文章",
  journal: "记录",
  memoir: "回忆录",
  storageBox: "储物箱",
  storageItem: "储物物品",
  idea: "想法",
  readingItem: "收藏",
  expense: "消费",
  problem: "问题",
  solution: "方案",
  progress: "进展",
  domain: "领域",
  activity: "子领域",
  session: "计时",
  habit: "习惯",
  metric: "指标",
  wallet: "账户",
  importantDay: "重要日子",
  checklist: "清单",
  achievement: "成就",
};
export function Discover({ navigate }: { navigate: Navigate }) {
  const tasks = useTaskSummary();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [month, setMonth] = useState(monthNow());
  const needle = query.trim().toLowerCase();
  const searchable = useEverything(Boolean(needle));
  const entities = useDatedEntities(month + "-01", month + "-31", "expense", "journal", "progress", "document");
  const { entities: sessions } = useEntities("session");
  const matches = useMemo(() => {
    if (!needle) return [];
    const hits: Entity[] = [];
    for (const entity of searchable) {
      if (!entity.deleted && (kind === "all" || entity.type === kind) &&
          Object.values(entity.data).some((value) => String(value).toLowerCase().includes(needle))) {
        hits.push(entity);
        if (hits.length === 100) break;
      }
    }
    return hits;
  }, [searchable, needle, kind]);
  const daily = useMemo(() => timeSummary(sessions, Date.now()).daily, [sessions, month]);
  const taskMatches = needle ? tasks.filter((t) => t.title.toLowerCase().includes(needle)) : [];
  const expense = entities
    .filter((e) => e.type === "expense" && str(e, "day").startsWith(month))
    .reduce((n, e) => n + net(e), 0n);
  return (
    <>
      <Heading
        eyebrow="FIND & REFLECT"
        title="发现"
        description="从自己的记录里寻找答案。"
      />
      <div className="columns discover">
        <Panel title="搜索" className="search-panel">
          <div className="global-search">
            <Icon name="discover" size={22} />
            <input
              aria-label="全局搜索"
              placeholder="搜索你的文章、记录、问题、消费…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="all">全部内容</option>
              {[
                ["document", "文章"],
                ["journal", "每日记录"],
                ["memoir", "回忆录"],
                ["storageItem", "储物物品"],
                ["expense", "消费"],
                ["problem", "问题"],
                ["idea", "想法"],
                ["readingItem", "收藏"],
                ["achievement", "成就"],
              ].map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {needle ? (
            <>
              <div className="search-results">
                {taskMatches.map((t) => (
                    <button key={t.id} onClick={() => navigate("tasks")}>
                      <small>任务</small>
                      <strong>{t.title}</strong>
                    </button>
                  ))}
                {matches.map((e) => (
                  <button
                    key={e.id}
                    onClick={() => {
                      let key = typeFeature[e.type] ?? "home";
                      if (e.type === "document") {
                        const docKind = str(e, "kind");
                        key =
                          docKind === "thought"
                            ? "thoughts"
                            : docKind === "monthly"
                              ? "monthly"
                              : "notes";
                        localStorage.setItem(
                          "pc-next-selected-doc-" + docKind,
                          JSON.stringify(e.id),
                        );
                      }
                      if (e.type === "journal")
                        key = e.data.kind === "raw" ? "raw" : "chronicle";
                      navigate(key);
                    }}
                  >
                    <small>
                      {kindName[e.type] ?? e.type} ·{" "}
                      {str(e, "day", e.updatedAt.slice(0, 10))}
                    </small>
                    <strong>
                      {str(
                        e,
                        "title",
                        str(e, "name", str(e, "body").slice(0, 80)),
                      )}
                    </strong>
                    <p>{str(e, "body").slice(0, 160)}</p>
                  </button>
                ))}
              </div>
              {!matches.length && !taskMatches.length && (
                  <Empty text="没有找到相关记录" />
                )}
            </>
          ) : (
            <Empty text="输入关键词，在所有本机记录里查找" />
          )}
        </Panel>
        <Panel
          title="个人回顾"
          aside={<Month value={month} onChange={setMonth} />}
        >
          <Stats
            items={[
              [
                "推进时间",
                duration(
                  Object.entries(
                    daily,
                  )
                    .filter(([day]) => day.startsWith(month))
                    .reduce((sum, [, seconds]) => sum + seconds, 0),
                ),
              ],
              [
                "记录件数",
                String(
                  entities.filter(
                    (e) =>
                      e.type === "journal" && str(e, "day").startsWith(month),
                  ).length,
                ),
              ],
              [
                "文章",
                String(
                  entities.filter(
                    (e) =>
                      e.type === "document" && str(e, "day").startsWith(month),
                  ).length,
                ),
              ],
              ["实际净消费", money(expense)],
            ]}
          />
          <div className="dense-list">
            {entities
              .filter(
                (e) =>
                  ["journal", "progress", "document"].includes(e.type) &&
                  str(e, "day").startsWith(month),
              )
              .slice(-20)
              .reverse()
              .map((e) => (
                <div key={e.id}>
                  <button
                    className="row-main"
                    onClick={() => navigate(typeFeature[e.type] ?? "home")}
                  >
                    <strong>
                      {str(e, "title", str(e, "body").slice(0, 100))}
                    </strong>
                    <small>{str(e, "day")}</small>
                  </button>
                </div>
              ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
export function Settings({
  theme,
  setTheme,
}: {
  theme: string;
  setTheme: (value: string) => void;
}) {
  const ws = useWorkspaceConfig();
  const [overview, setOverview] = useState<WorkspaceOverview>({ live: 0, deleted: 0, trash: [] });
  const pending = usePending();
  const conflicts = pending.filter(
    (p) => p.state === "conflict" || p.state === "error",
  );
  const { message } = useSyncStatus();
  const [trash, setTrash] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showModules, setShowModules] = useState(true);
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [deptDrafts, setDeptDrafts] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const enabledCount = TOGGLEABLE_FEATURES.filter((k) => ws.isEnabled(k)).length;
  const hasAnyAlias =
    Object.keys(ws.featureAliases).length > 0 ||
    Object.keys(ws.departmentAliases).length > 0;
  useEffect(() => {
    let active = true;
    let requested = false;
    let loading = false;
    function refresh() {
      requested = true;
      if (!loading) perform(read());
    }
    async function read() {
      loading = true;
      try {
        while (active && requested) {
          requested = false;
          const result = await readWorkspaceOverview(trash);
          if (active) setOverview(result);
        }
      } finally {
        loading = false;
      }
    }
    const unsubscribe = subscribeWorkspaceOverview(refresh);
    refresh();
    return () => { active = false; unsubscribe(); };
  }, [trash]);
  async function download() {
    setExporting(true);
    try {
      await downloadFile("SELF-OS-" + today() + ".json", "application/json", writeWorkspaceExport);
    } finally {
      setExporting(false);
    }
  }
  async function copyConfig() {
    const json = ws.exportConfigJson();
    try {
      await navigator.clipboard.writeText(json);
      setImportMsg("已复制工作区配置 JSON。");
    } catch {
      setImportText(json);
      setImporting(true);
      setImportMsg("已生成配置 JSON，可复制或编辑后导入。");
    }
  }
  async function submitImport() {
    const res = await ws.importConfigJson(importText);
    if (res.ok) {
      setImportMsg("配置已导入并开始跨端同步。");
      setImporting(false);
      setImportText("");
    } else {
      setImportMsg(res.error ?? "导入失败。");
    }
  }
  return (
    <>
      <Heading eyebrow="PREFERENCES" title="设置" />
      <Panel
        title="工作区与模块定制（跨端自动同步）"
        aside={
          <div className="ws-config-actions">
            <span className="ws-config-count">
              已启用 {enabledCount}/{TOGGLEABLE_FEATURES.length} 项
              {ws.preset === "custom" ? " · 自定义" : ""}
            </span>
            <button type="button" onClick={() => setShowModules(!showModules)}>
              {showModules ? "收起明细" : "展开自定义"}
            </button>
          </div>
        }
      >
        <p className="muted-note">
          切换预设或单独开关模块不会删除任何历史记录；修改后会自动同步到 Mac、Web 与 iPhone。模块默认保持原生命名，也可按习惯自定义别名。
        </p>
        <div className="ws-preset-grid">
          {PRESET_LIST.map((p) => {
            const active = ws.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                className={"ws-preset-card" + (active ? " active" : "")}
                onClick={() => perform(ws.applyPreset(p.id))}
              >
                <div className="ws-preset-head">
                  <strong>{p.title}</strong>
                  <small>{p.badge}</small>
                </div>
                <span>{p.description}</span>
              </button>
            );
          })}
        </div>

        {showModules && (
          <div className="ws-custom-sections">
            <div className="ws-custom-group">
              <div className="ws-custom-head">
                <strong>功能模块开关与自定义名称</strong>
                {hasAnyAlias && (
                  <button
                    type="button"
                    className="muted"
                    onClick={() => {
                      setAliasDrafts({});
                      setDeptDrafts({});
                      perform(ws.resetAllAliases());
                    }}
                  >
                    恢复全部原名
                  </button>
                )}
              </div>
              <div className="ws-module-grid">
                {TOGGLEABLE_FEATURES.map((key) => {
                  const f = feature(key);
                  const on = ws.isEnabled(key);
                  const draft =
                    key in aliasDrafts
                      ? aliasDrafts[key]
                      : ws.featureAliases[key] ?? "";
                  return (
                    <div
                      key={key}
                      className={"ws-module-row" + (on ? "" : " off")}
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        className={"ws-switch" + (on ? " on" : "")}
                        onClick={() => perform(ws.toggleFeature(key))}
                        title={on ? "点击隐藏此模块" : "点击启用此模块"}
                      >
                        <Icon name={key} size={14} />
                        <span>{f.name}</span>
                        <small>{on ? "开" : "关"}</small>
                      </button>
                      <input
                        className="ws-alias-input"
                        maxLength={40}
                        placeholder={`自定义名（默认：${f.name}）`}
                        aria-label={`${f.name} 自定义显示名称`}
                        value={draft}
                        onChange={(e) =>
                          setAliasDrafts((prev) => ({
                            ...prev,
                            [key]: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (!(key in aliasDrafts)) return;
                          const val = aliasDrafts[key];
                          setAliasDrafts((prev) => {
                            const copy = { ...prev };
                            delete copy[key];
                            return copy;
                          });
                          if (val.trim() !== (ws.featureAliases[key] ?? "")) {
                            perform(ws.setFeatureAlias(key, val));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ws-custom-group">
              <div className="ws-custom-head">
                <strong>内置部门显示与自定义名称</strong>
              </div>
              <div className="ws-module-grid">
                {BUILTIN_DEPARTMENTS.map((name) => {
                  const visible = ws.isDepartmentVisible(name);
                  const draft =
                    name in deptDrafts
                      ? deptDrafts[name]
                      : ws.departmentAliases[name] ?? "";
                  return (
                    <div
                      key={name}
                      className={"ws-module-row" + (visible ? "" : " off")}
                    >
                      <button
                        type="button"
                        role="switch"
                        aria-checked={visible}
                        className={"ws-switch" + (visible ? " on" : "")}
                        onClick={() => perform(ws.toggleDepartment(name))}
                      >
                        <span>{name}</span>
                        <small>{visible ? "显" : "隐"}</small>
                      </button>
                      <input
                        className="ws-alias-input"
                        maxLength={40}
                        placeholder={`自定义部门名（默认：${name}）`}
                        aria-label={`${name} 自定义部门名称`}
                        value={draft}
                        onChange={(e) =>
                          setDeptDrafts((prev) => ({
                            ...prev,
                            [name]: e.target.value,
                          }))
                        }
                        onBlur={() => {
                          if (!(name in deptDrafts)) return;
                          const val = deptDrafts[name];
                          setDeptDrafts((prev) => {
                            const copy = { ...prev };
                            delete copy[name];
                            return copy;
                          });
                          if (val.trim() !== (ws.departmentAliases[name] ?? "")) {
                            perform(ws.setDepartmentAlias(name, val));
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            (e.currentTarget as HTMLInputElement).blur();
                          }
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="ws-io-row">
              <button type="button" onClick={() => void copyConfig()}>
                复制工作区配置 JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  setImporting(!importing);
                  setImportMsg("");
                }}
              >
                {importing ? "取消导入" : "导入配置 JSON"}
              </button>
              {importMsg && <small className="ws-io-msg">{importMsg}</small>}
            </div>
            {importing && (
              <div className="ws-import-box">
                <textarea
                  rows={5}
                  placeholder="粘贴工作区配置 JSON…"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={!importText.trim()}
                  onClick={() => void submitImport()}
                >
                  应用导入配置
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>
      <div className="columns even settings">
        <Panel title="外观与设备">
          <label className="settings-line">
            外观
            <select value={theme} onChange={(e) => setTheme(e.target.value)}>
              <option value="system">跟随系统</option>
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <div className="settings-line">
            <span>同步</span>
            <strong>{message}</strong>
          </div>
          <div className="settings-line">
            <span>本机待发送</span>
            <strong>{pending.length} 条</strong>
          </div>
          {isAndroidApp() && (
            <div className="settings-line">
              <span>Android 服务器</span>
              <button
                type="button"
                onClick={() => openAndroidEndpointSettings()}
              >
                连接设置…
              </button>
            </div>
          )}
          <p className="muted-note">
            模块开关、别名与部门定制跨端自动同步；首页排版、分屏与主题保存在当前设备。
          </p>
          <button disabled={exporting} onClick={() => perform(download())}>
            {exporting ? "正在导出…" : "导出已下载资料"}
          </button>
        </Panel>
        <Panel
          title="资料与回收站"
          aside={
            <button onClick={() => setTrash(!trash)}>
              {trash ? "收起" : "查看回收站"}
            </button>
          }
        >
          <Stats
            items={[
              ["已下载记录", String(overview.live)],
              ["已删除", String(overview.deleted)],
            ]}
          />
          {trash && (
            <div className="dense-list">
              {overview.trash.map((e) => (
                  <div key={e.id}>
                    <span>
                      {str(
                        e,
                        "title",
                        str(e, "name", str(e, "body").slice(0, 50)),
                      )}
                    </span>
                    <button onClick={() => perform(put(e.type, e.data, e))}>
                      恢复
                    </button>
                  </div>
                ))}
            </div>
          )}
        </Panel>
      </div>
      {conflicts.length > 0 && (
        <Panel title="需要处理的同步记录">
          <div className="conflict-list">
            {conflicts.map((p) => {
              const batchMembers = p.batchId
                ? pending.filter((op) => op.batchId === p.batchId)
                : [];
              const isTransferBatch =
                Boolean(p.batchId) &&
                batchMembers.some((op) => op.entityType === "idea") &&
                batchMembers.some((op) => op.entityType === "journal");
              return (
                <div key={p.operationId}>
                  <h3>
                    {String(
                      p.data?.title ??
                        p.data?.name ??
                        p.data?.body ??
                        p.entityType,
                    ).slice(0, 100)}
                  </h3>
                  <p>
                    {isTransferBatch
                      ? "另一端已修改原文，此次「想法 ↔ 原料」迁移未生效。请先采用服务器版本，再打开最新原文重新选段。"
                      : p.recoveryDraft
                        ? p.error
                        : p.state === "error"
                          ? "无法提交：" + p.error
                          : "另一端已经修改这条记录，本机版本仍被保留。"}
                  </p>
                  {p.recoveryDraft && (
                    <blockquote>
                      {p.recoveryDraft.deleted ? "删除记录" :
                        String(p.recoveryDraft.data.body ?? p.recoveryDraft.data.title ??
                          p.recoveryDraft.data.name ?? p.recoveryDraft.type)}
                    </blockquote>
                  )}
                  {p.server && (
                    <blockquote>
                      {String(
                        p.server.data.body ??
                          p.server.data.title ??
                          p.server.data.name ??
                          "",
                      )}
                    </blockquote>
                  )}
                  {!isTransferBatch && (
                    <button onClick={() => perform(settle(p.entityId, true))}>
                      重新提交本机版本
                    </button>
                  )}
                  <button onClick={() => perform(settle(p.entityId, false))}>
                    {isTransferBatch
                      ? "采用服务器版本（之后重新选段）"
                      : "采用服务器版本 / 放弃本机修改"}
                  </button>
                </div>
              );
            })}
          </div>
        </Panel>
      )}
    </>
  );
}
