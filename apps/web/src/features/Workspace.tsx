import { timeSummary } from "../../../../modules/practice/index.ts";
import React, { useMemo, useState } from "react";
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
  usePending,
  useSyncStatus,
  put,
  settle,
  remove,
  type AnyEntity as Entity,
} from "../data/entities.ts";
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
  const defaults = ["中科院", "执行部", "财政部", "档案库"];
  const custom = entities.filter((e) => e.type === "department");
  const all = [
    ...defaults.map((name) => ({
      id: name,
      name,
      keys: features.filter((f) => f.department === name).map((f) => f.key),
    })),
    ...custom.map((e) => ({
      id: e.id,
      name: str(e, "name"),
      keys: arr(e, "features") as FeatureKey[],
    })),
  ];
  const current = all.find((e) => e.id === selected);
  return (
    <>
      <Heading
        eyebrow="YOUR WORKSPACES"
        title={current ? current.name : "部门与知识库"}
      >
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
                <h2>{feature(key).name}</h2>
                <small>进入功能 ↗</small>
              </button>
            ))}
          </div>
          {current.name === "中科院" && (
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
                        {departmentMarks[d.name] ? (
                          <Icon name={departmentMarks[d.name]} size={20} />
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
                      {!defaults.includes(d.id) && (
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
                        {feature(key).name}
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
};
const kindName: Record<string, string> = {
  document: "文章",
  journal: "记录",
  idea: "想法",
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
};
export function Discover({ navigate }: { navigate: Navigate }) {
  // Search and review are the two places that deliberately read the whole local database.
  const everything = useEverything();
  const entities = useMemo(
    () => everything.filter((e) => !e.deleted),
    [everything],
  );
  const tasks = useTaskSummary();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [month, setMonth] = useState(monthNow());
  const matches = query.trim()
    ? entities
        .filter(
          (e) =>
            (kind === "all" || e.type === kind) &&
            Object.values(e.data).some((v) =>
              String(v).toLowerCase().includes(query.toLowerCase()),
            ),
        )
        .slice(0, 100)
    : [];
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
                ["expense", "消费"],
                ["problem", "问题"],
                ["idea", "想法"],
              ].map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          {query ? (
            <>
              <div className="search-results">
                {tasks
                  .filter((t) =>
                    t.title.toLowerCase().includes(query.toLowerCase()),
                  )
                  .map((t) => (
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
              {!matches.length &&
                !tasks.some((t) => t.title.includes(query)) && (
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
                    timeSummary(
                      entities.filter((e) => e.type === "session"),
                      Date.now(),
                    ).daily,
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
  const all = useEverything();
  const entities = useMemo(() => all.filter((e) => !e.deleted), [all]);
  const pending = usePending();
  const conflicts = pending.filter(
    (p) => p.state === "conflict" || p.state === "error",
  );
  const { message } = useSyncStatus();
  const [trash, setTrash] = useState(false);
  function download() {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              format: "personal-council-next",
              version: 1,
              exportedAt: new Date().toISOString(),
              entities: all,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    link.download = "SELF-OS-" + today() + ".json";
    link.click();
    URL.revokeObjectURL(link.href);
  }
  return (
    <>
      <Heading eyebrow="PREFERENCES" title="设置" />
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
          <p className="muted-note">
            首页排版、常用部门与常用功能保存在当前设备。
          </p>
          <button onClick={download}>导出已下载资料</button>
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
              ["已下载记录", String(entities.length)],
              ["已删除", String(all.filter((e) => e.deleted).length)],
            ]}
          />
          {trash && (
            <div className="dense-list">
              {all
                .filter((e) => e.deleted)
                .map((e) => (
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
            {conflicts.map((p) => (
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
                  {p.state === "error"
                    ? "无法提交：" + p.error
                    : "另一端已经修改这条记录，本机版本仍被保留。"}
                </p>
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
                <button onClick={() => perform(settle(p.entityId, true))}>
                  重新提交本机版本
                </button>
                <button onClick={() => perform(settle(p.entityId, false))}>
                  采用服务器版本 / 放弃本机修改
                </button>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}
