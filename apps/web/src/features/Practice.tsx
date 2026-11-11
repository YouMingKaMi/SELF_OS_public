import { timeSummary } from "../../../../modules/practice/index.ts";
import React, { useState, useEffect } from "react";
import "./practice.css";
import {
  useEntities,
  put,
  type AnyEntity as Entity,
  type Data,
} from "../data/entities.ts";
import {
  Heading,
  Panel,
  Empty,
  RecordForm,
  BarChart,
  Stats,
  Month,
  monthNow,
  today,
  str,
  num,
  arr,
  perform,
  usePreference,
  daysInMonth,
} from "../ui/shared.tsx";
import {
  duration,
  sessionSeconds,
  controlSession,
  Timer,
} from "./PracticeTimer.tsx";
export function Practice() {
  const { entities } = useEntities(
    "domain",
    "activity",
    "problem",
    "solution",
    "session",
    "progress",
  );
  const domains = entities
    .filter((e) => e.type === "domain")
    .sort((a, b) => num(a, "order") - num(b, "order"));
  const [domainId, setDomain] = usePreference("practice-domain", "");
  const domain = domains.find((e) => e.id === domainId) ?? domains[0];
  const activities = entities.filter(
    (e) =>
      e.type === "activity" &&
      e.data.domainId === domain?.id &&
      !e.data.archived,
  );
  const [activityId, setActivity] = useState("");
  const [tab, setTab] = useState("activities");
  const [problemId, setProblem] = useState("");
  const [solutionId, setSolution] = useState("");
  const [form, setForm] = useState<
    "domain" | "activity" | "problem" | "solution" | "manual" | null
  >(null);
  const [editing, setEditing] = useState<Entity>();
  const [month, setMonth] = useState(monthNow());
  const [note, setNote] = usePreference("practice-progress-draft", "");
  const problems = entities.filter(
    (e) =>
      e.type === "problem" &&
      e.data.domainId === domain?.id &&
      (!activityId || e.data.activityId === activityId),
  );
  // The problem shown on the right; only an explicitly chosen one becomes part of what you push.
  const problem = problems.find((e) => e.id === problemId) ?? problems[0];
  const scopeProblem = problems.find((e) => e.id === problemId);
  const solutions = entities.filter(
    (e) => e.type === "solution" && e.data.problemId === problem?.id,
  );
  const selectedSolution = solutions.find((e) => e.id === solutionId);
  const sessions = entities.filter(
    (e) => e.type === "session" && e.data.domainId === domain?.id,
  );
  const running = entities.find(
    (e) =>
      e.type === "session" && ["running", "paused"].includes(str(e, "status")),
  );
  const logs = entities
    .filter(
      (e) =>
        e.type === "progress" &&
        e.data.domainId === domain?.id &&
        (!activityId || e.data.activityId === activityId) &&
        (!scopeProblem || e.data.problemId === scopeProblem.id),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  function path(e?: Entity): string {
    if (!e) return "领域记录";
    const names = [str(e, "title")];
    const seen = new Set([e.id]);
    let parent = solutions.find((s) => s.id === e.data.parentId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(str(parent, "title"));
      parent = solutions.find((s) => s.id === parent!.data.parentId);
    }
    return names.join(" / ");
  }
  async function start() {
    if (!domain) throw new Error("请先添加领域");
    if (running) throw new Error("先结束或取消当前计时");
    await put("session", {
      domainId: domain.id,
      ...(activityId ? { activityId } : {}),
      ...(scopeProblem ? { problemId: scopeProblem.id } : {}),
      ...(scopeProblem && selectedSolution
        ? { solutionId: selectedSolution.id }
        : {}),
      title:
        selectedSolution && scopeProblem
          ? str(selectedSolution, "title")
          : scopeProblem
            ? str(scopeProblem, "title")
            : str(
                activities.find((e) => e.id === activityId),
                "name",
                str(domain, "name"),
              ),
      day: today(),
      startedAt: new Date().toISOString(),
      runningSince: new Date().toISOString(),
      elapsedSeconds: 0,
      segments: [],
      status: "running",
      manual: false,
    });
  }
  function open(type: typeof form, e?: Entity) {
    setEditing(e);
    setForm(type);
  }
  async function progress() {
    if (!domain || !note.trim()) return;
    await put("progress", {
      domainId: domain.id,
      ...(activityId ? { activityId } : {}),
      ...(scopeProblem ? { problemId: scopeProblem.id } : {}),
      ...(scopeProblem && selectedSolution
        ? { solutionId: selectedSolution.id }
        : {}),
      day: today(),
      body: note,
    });
    setNote("");
  }
  const summary = timeSummary(sessions, Date.now());
  const total = Object.entries(summary.daily)
    .filter(([day]) => day.startsWith(month))
    .reduce((sum, [, seconds]) => sum + seconds, 0);
  const statusName: Record<string, string> = {
    pending: "待推进",
    active: "推进中",
    resolved: "已解决",
    discarded: "已废弃",
  };
  const activityName = str(
    activities.find((e) => e.id === activityId),
    "name",
  );
  const monthSeconds = (list: Entity[]) =>
    Object.entries(timeSummary(list, Date.now()).daily)
      .filter(([day]) => day.startsWith(month))
      .reduce((sum, [, seconds]) => sum + seconds, 0);
  const todaySeconds = summary.daily[today()] ?? 0;
  /** Totals read better as 3h 05m than as a stopwatch. */
  const hours = (seconds: number) => {
    const m = Math.round(seconds / 60);
    return m < 60
      ? m + "m"
      : Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m";
  };
  // Solutions as a tree, depth-first, so branches read top to bottom.
  const tree: { e: Entity; depth: number }[] = [];
  (function walk(parent: string | undefined, depth: number) {
    for (const e of solutions.filter(
      (s) => (s.data.parentId || undefined) === parent,
    )) {
      if (tree.some((row) => row.e.id === e.id)) continue;
      tree.push({ e, depth });
      walk(e.id, depth + 1);
    }
  })(undefined, 0);
  for (const e of solutions)
    if (!tree.some((row) => row.e.id === e.id)) tree.push({ e, depth: 0 });
  return (
    <>
      <Heading
        eyebrow="YOUR PERSONAL PRACTICE"
        title="个人推进台"
        description="领域 → 子领域 → 问题 → 方案。左边推进，右边看全局。"
      >
        <button onClick={() => open("domain")}>＋ 领域</button>
        <button
          className="primary"
          disabled={!domain}
          onClick={() => open("manual")}
        >
          ＋ 补记时间
        </button>
      </Heading>
      <div className="practice-bar">
        <div className="domain-chips">
          {domains.map((e) => (
            <button
              key={e.id}
              className={domain?.id === e.id ? "selected" : ""}
              onClick={() => {
                setDomain(e.id);
                setActivity("");
                setProblem("");
                setSolution("");
              }}
            >
              {e.data.focused ? <i className="focus-dot" /> : null}
              {str(e, "name")}
            </button>
          ))}
        </div>
        {domain && (
          <div className="toolbar">
            <button
              className="ghost"
              onClick={() =>
                perform(
                  put(
                    "domain",
                    { ...domain.data, focused: !domain.data.focused },
                    domain,
                  ),
                )
              }
            >
              {domain.data.focused ? "★ 当前专注" : "☆ 加入专注"}
            </button>
            <button className="ghost" onClick={() => open("domain", domain)}>
              编辑领域
            </button>
          </div>
        )}
      </div>
      {domain ? (
        <div className="columns practice">
          <Panel
            className="practice-cockpit"
            title="此刻推进"
            aside={
              <small className="mono">
                今日 {hours(todaySeconds)} · 本月 {hours(total)}
              </small>
            }
          >
            <div className="scope">
              <span className="crumb strong">{str(domain, "name")}</span>
              <span className="sep">/</span>
              <select
                aria-label="推进子领域"
                value={activityId}
                onChange={(e) => {
                  setActivity(e.target.value);
                  setProblem("");
                  setSolution("");
                }}
              >
                <option value="">整个领域</option>
                {activities.map((e) => (
                  <option value={e.id} key={e.id}>
                    {str(e, "name")}
                  </option>
                ))}
              </select>
              {scopeProblem && (
                <>
                  <span className="sep">/</span>
                  <button
                    className="crumb"
                    title="移出问题"
                    onClick={() => {
                      setProblem("");
                      setSolution("");
                    }}
                  >
                    {str(scopeProblem, "title")} ×
                  </button>
                </>
              )}
              {scopeProblem && selectedSolution && (
                <>
                  <span className="sep">/</span>
                  <button
                    className="crumb"
                    title="移出方案"
                    onClick={() => setSolution("")}
                  >
                    {path(selectedSolution)} ×
                  </button>
                </>
              )}
            </div>
            <div className={"timer-stage" + (running ? " live" : "")}>
              {running ? (
                <>
                  <div className="timer-face">
                    <small>
                      {running.data.status === "running"
                        ? "正在推进"
                        : "已暂停"}{" "}
                      · {str(running, "title")}
                    </small>
                    <Timer session={running} />
                  </div>
                  <div className="timer-controls">
                    <button
                      onClick={() =>
                        perform(
                          controlSession(
                            running,
                            running.data.status === "running"
                              ? "pause"
                              : "resume",
                          ),
                        )
                      }
                    >
                      {running.data.status === "running" ? "暂停" : "继续"}
                    </button>
                    <button
                      className="primary"
                      onClick={() => perform(controlSession(running, "finish"))}
                    >
                      结束
                    </button>
                    <button
                      className="muted"
                      onClick={() => perform(controlSession(running, "cancel"))}
                    >
                      取消本次
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="timer-face idle">
                    <small>
                      {scopeProblem
                        ? selectedSolution
                          ? "沿方案推进"
                          : "推进这个问题"
                        : activityName
                          ? "推进这个子领域"
                          : "直接推进这个领域"}
                    </small>
                    <span className="timer-digits">00:00</span>
                  </div>
                  <div className="timer-controls">
                    <button
                      className="primary"
                      onClick={() => perform(start())}
                    >
                      ▷ 开始推进
                    </button>
                  </div>
                </>
              )}
            </div>
            <div className="capture-box">
              <textarea
                className="capture-text"
                aria-label="推进记录"
                placeholder="记下这一步的进展、发现或卡点…"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <div className="form-actions">
                <small>
                  记在：
                  {scopeProblem
                    ? path(selectedSolution) === "领域记录"
                      ? str(scopeProblem, "title")
                      : path(selectedSolution)
                    : activityName || str(domain, "name")}
                </small>
                <button
                  className="primary"
                  disabled={!note.trim()}
                  onClick={() => perform(progress())}
                >
                  记下进展
                </button>
              </div>
            </div>
            <div className="progress-timeline">
              {logs.length === 0 && <p className="timeline-empty">这里会按时间留下每一步进展</p>}
              {logs.map((e) => (
                <div key={e.id}>
                  <aside>
                    <span>{str(e, "day").slice(5)}</span>
                  </aside>
                  <div>
                    <p>{str(e, "body")}</p>
                    <small>
                      {e.data.problemId
                        ? str(
                            entities.find((p) => p.id === e.data.problemId),
                            "title",
                          ) +
                          (e.data.solutionId
                            ? " / " +
                              path(
                                solutions.find(
                                  (s) => s.id === e.data.solutionId,
                                ),
                              )
                            : "")
                        : str(
                            activities.find((a) => a.id === e.data.activityId),
                            "name",
                            "领域记录",
                          )}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel
            className="practice-map"
            title={
              tab === "stats"
                ? "时间统计"
                : tab === "problems"
                  ? "问题与方案"
                  : "子领域"
            }
            aside={
              <>
                <div className="segmented">
                  {[
                    ["activities", "子领域"],
                    ["problems", "问题推进"],
                    ["stats", "时间统计"],
                  ].map(([key, label]) => (
                    <button
                      className={tab === key ? "active" : ""}
                      onClick={() => setTab(key)}
                      key={key}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {tab === "stats" && <Month value={month} onChange={setMonth} />}
              </>
            }
          >
            {tab === "activities" && (
              <>
                <div className="dense-list activity-list">
                  <button
                    className={!activityId ? "selected" : ""}
                    onClick={() => {
                      setActivity("");
                      setProblem("");
                      setSolution("");
                    }}
                  >
                    <span className="row-main">
                      <strong>整个领域</strong>
                      <small>不细分，直接推进</small>
                    </span>
                    <span className="mono">{hours(total)}</span>
                  </button>
                  {activities.map((e) => {
                    const seconds = monthSeconds(
                      sessions.filter((s) => s.data.activityId === e.id),
                    );
                    return (
                      <button
                        key={e.id}
                        className={activityId === e.id ? "selected" : ""}
                        onClick={() => {
                          setActivity(e.id);
                          setProblem("");
                          setSolution("");
                        }}
                      >
                        <span className="row-main">
                          <strong>{str(e, "name")}</strong>
                          <small>
                            {
                              entities.filter(
                                (p) =>
                                  p.type === "problem" &&
                                  p.data.activityId === e.id,
                              ).length
                            }{" "}
                            个问题 · 本月
                          </small>
                        </span>
                        <span className="bar">
                          <i
                            style={{
                              width:
                                (total ? (seconds / total) * 100 : 0) + "%",
                            }}
                          />
                        </span>
                        <span className="mono">{hours(seconds)}</span>
                      </button>
                    );
                  })}
                </div>
                <button
                  className="ghost add-row"
                  onClick={() => open("activity")}
                >
                  ＋ 子领域
                </button>
                <Rhythm
                  name={activityName || str(domain, "name")}
                  daily={
                    timeSummary(
                      activityId ? sessions.filter((s) => s.data.activityId === activityId) : sessions,
                      Date.now(),
                    ).daily
                  }
                  month={monthNow()}
                  hours={hours}
                />
              </>
            )}
            {tab === "problems" && (
              <div className="problem-map">
                <div className="problem-list">
                  <div className="label">
                    问题 · {problems.length}
                    <button className="ghost" onClick={() => open("problem")}>
                      ＋
                    </button>
                  </div>
                  <div className="article-list">
                    {problems.length === 0 && (
                      <Empty text="记下一个真正想解决的问题" />
                    )}
                    {problems.map((e) => (
                      <button
                        className={
                          (problem?.id === e.id ? "selected " : "") +
                          str(e, "status")
                        }
                        onClick={() => {
                          setProblem(e.id);
                          setSolution("");
                        }}
                        key={e.id}
                      >
                        <strong>{str(e, "title")}</strong>
                        <small>
                          {statusName[str(e, "status")]}
                          {scopeProblem?.id === e.id ? " · 正在推进" : ""}
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="solution-pane">
                  {problem ? (
                    <>
                      <div className="label">
                        方案链
                        <span>
                          <button
                            className="ghost"
                            onClick={() => open("problem", problem)}
                          >
                            编辑问题
                          </button>
                          <button
                            className="ghost"
                            onClick={() => {
                              setProblem(problem.id);
                              open("solution");
                            }}
                          >
                            ＋ 方案
                          </button>
                        </span>
                      </div>
                      <div className="solution-tree">
                        {tree.length === 0 && (
                          <Empty text="还没有方案。可以直接推进问题本身。" />
                        )}
                        {tree.map(({ e, depth }) => (
                          <div
                            className={
                              (selectedSolution?.id === e.id
                                ? "selected "
                                : "") + str(e, "status")
                            }
                            style={{ "--depth": depth } as React.CSSProperties}
                            key={e.id}
                          >
                            <button
                              className="node"
                              onClick={() => {
                                setProblem(problem.id);
                                setSolution(e.id);
                              }}
                            >
                              <i />
                              <strong>{str(e, "title")}</strong>
                              <span className="pill">
                                {statusName[str(e, "status")] ??
                                  str(e, "status")}
                              </span>
                            </button>
                            {e.data.reason && <p>{str(e, "reason")}</p>}
                            <span className="row-tools">
                              <button
                                onClick={() => {
                                  setProblem(problem.id);
                                  setSolution(e.id);
                                }}
                              >
                                沿这条链推进
                              </button>
                              <button onClick={() => open("solution", e)}>
                                编辑
                              </button>
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : (
                    <Empty text="选择左侧的问题" />
                  )}
                </div>
              </div>
            )}
            {tab === "stats" && (
              <>
                <Stats
                  items={[
                    ["本月总计", hours(total)],
                    [
                      "记录次数",
                      String(
                        sessions.filter(
                          (e) =>
                            String(e.data.day).startsWith(month) &&
                            e.data.status !== "cancelled",
                        ).length,
                      ),
                    ],
                    ["今日", hours(todaySeconds)],
                  ]}
                />
                <BarChart
                  label="每日推进时长"
                  unit=" 分钟"
                  points={daysInMonth(month).map((day) => ({
                    x: day,
                    y: summary.daily[day] === undefined ? null : Math.round(summary.daily[day] / 60),
                    done: true,
                  }))}
                />
                <p className="muted-note">
                  总计按时间段去重；手动补记单独计入。
                  {summary.overlapSeconds > 0
                    ? `检测到 ${Math.round(summary.overlapSeconds / 60)} 分钟重叠，合计已去重。`
                    : ""}
                </p>
                <div className="dense-list">
                  {sessions
                    .filter((e) => String(e.data.day).startsWith(month))
                    .sort((a, b) => str(b, "day").localeCompare(str(a, "day")))
                    .map((e) => (
                      <div
                        key={e.id}
                        className={
                          e.data.status === "cancelled" ? "cancelled" : ""
                        }
                      >
                        <span className="mono day">
                          {str(e, "day").slice(5)}
                        </span>
                        <span className="row-main">
                          <strong>{str(e, "title")}</strong>
                          <small>
                            {e.data.status === "cancelled"
                              ? "已取消"
                              : e.data.manual
                                ? "手动补记"
                                : "计时记录"}
                          </small>
                        </span>
                        <strong className="mono">
                          {duration(sessionSeconds(e))}
                        </strong>
                        {e.data.status !== "cancelled" && (
                          <span className="row-tools">
                            <button
                              onClick={() =>
                                perform(controlSession(e, "cancel"))
                              }
                            >
                              取消记录
                            </button>
                          </span>
                        )}
                      </div>
                    ))}
                </div>
              </>
            )}
          </Panel>
        </div>
      ) : (
        <Empty text="添加你的第一个领域，例如 AI、健身或自动化" />
      )}
      {form && (
        <div className="modal-backdrop">
          <div className="modal">
            <header>
              <h2>
                {form === "manual" ? "补记推进时间" : editing ? "编辑" : "添加"}
              </h2>
              <button onClick={() => setForm(null)}>×</button>
            </header>
            {form === "domain" && (
              <RecordForm
                key={"domain" + editing?.id}
                type="domain"
                entity={editing}
                defaults={{ name: "", focused: true, order: domains.length }}
                fields={[
                  { key: "name", label: "领域名称", required: true },
                  { key: "focused", label: "首页专注", type: "checkbox" },
                ]}
                onSaved={() => setForm(null)}
                onCancel={() => setForm(null)}
              />
            )}{" "}
            {form === "activity" && domain && (
              <RecordForm
                type="activity"
                defaults={{ domainId: domain.id, name: "", archived: false }}
                fields={[{ key: "name", label: "子领域名称", required: true }]}
                onSaved={(id) => {
                  setActivity(id);
                  setForm(null);
                }}
                onCancel={() => setForm(null)}
              />
            )}{" "}
            {form === "problem" && domain && (
              <RecordForm
                key={"problem" + editing?.id}
                type="problem"
                entity={editing}
                defaults={{
                  domainId: domain.id,
                  ...(activityId ? { activityId } : {}),
                  title: "",
                  status: "active",
                  focused: false,
                }}
                fields={[
                  { key: "title", label: "问题", required: true },
                  {
                    key: "status",
                    label: "状态",
                    type: "select",
                    options: [
                      ["pending", "待推进"],
                      ["active", "推进中"],
                      ["resolved", "已解决"],
                      ["discarded", "已废弃"],
                    ],
                  },
                ]}
                onSaved={(id) => {
                  setProblem(id);
                  setForm(null);
                }}
                onCancel={() => setForm(null)}
              />
            )}{" "}
            {form === "solution" && problem && (
              <RecordForm
                key={"solution" + editing?.id}
                type="solution"
                entity={editing}
                defaults={{
                  problemId: problem.id,
                  title: "",
                  status: "active",
                  ...(solutionId ? { parentId: solutionId } : {}),
                  reason: "",
                }}
                fields={[
                  { key: "title", label: "解决方案", required: true },
                  {
                    key: "parentId",
                    label: "父方案",
                    type: "select",
                    options: [
                      ["", "直接属于主问题"],
                      ...solutions
                        .filter((e) => e.id !== editing?.id)
                        .map(
                          (e) => [e.id, str(e, "title")] as [string, string],
                        ),
                    ],
                  },
                  {
                    key: "status",
                    label: "状态",
                    type: "select",
                    options: [
                      ["pending", "待推进"],
                      ["active", "推进中"],
                      ["resolved", "已完成"],
                      ["discarded", "已废弃"],
                    ],
                  },
                  { key: "reason", label: "发现 / 废弃原因", type: "textarea" },
                ]}
                onSaved={(id) => {
                  setSolution(id);
                  setForm(null);
                }}
                onCancel={() => setForm(null)}
              />
            )}{" "}
            {form === "manual" && domain && (
              <ManualSession
                domain={domain}
                activityId={activityId}
                problemId={scopeProblem?.id}
                solutionId={solutionId}
                onClose={() => setForm(null)}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}
function ManualSession({
  domain,
  activityId,
  problemId,
  solutionId,
  onClose,
}: {
  domain: Entity;
  activityId: string;
  problemId?: string;
  solutionId: string;
  onClose: () => void;
}) {
  const [day, setDay] = useState(today());
  const [minutes, setMinutes] = useState("30");
  const [title, setTitle] = useState(str(domain, "name"));
  return (
    <form
      className="record-form"
      onSubmit={(e) => {
        e.preventDefault();
        perform(
          put("session", {
            domainId: domain.id,
            ...(activityId ? { activityId } : {}),
            ...(problemId ? { problemId } : {}),
            ...(solutionId ? { solutionId } : {}),
            title,
            day,
            elapsedSeconds: Number(minutes) * 60,
            status: "finished",
            manual: true,
            segments: [],
          }).then(onClose),
        );
      }}
    >
      <label>
        内容
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label>
        日期
        <input
          type="date"
          required
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <label>
        分钟
        <input
          type="number"
          required
          min="0.01"
          max="1440"
          step="0.01"
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
        />
      </label>
      <button className="primary">保存时间</button>
    </form>
  );
}

/** The scope's rhythm at a glance: this month's numbers, a bar per day, and half a year as a heat grid. */
function Rhythm({
  name,
  daily,
  month,
  hours,
}: {
  name: string;
  daily: Record<string, number>;
  month: string;
  hours: (seconds: number) => string;
}) {
  const now = today();
  const days = daysInMonth(month);
  const monthTotal = days.reduce((n, d) => n + (daily[d] ?? 0), 0);
  const activeDays = days.filter((d) => (daily[d] ?? 0) > 0).length;
  const shift = (day: string, by: number) => {
    const d = new Date(day + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + by);
    return d.toISOString().slice(0, 10);
  };
  let streak = 0;
  for (let d = (daily[now] ?? 0) > 0 ? now : shift(now, -1); (daily[d] ?? 0) > 0; d = shift(d, -1)) streak++;
  // 26 weeks ending this week, Sunday on top.
  const weekday = new Date(now + "T12:00:00Z").getUTCDay();
  const start = shift(now, -(25 * 7 + weekday));
  const cells = Array.from({ length: 26 * 7 }, (_, i) => shift(start, i));
  const peak = Math.max(1, ...cells.map((d) => daily[d] ?? 0));
  const level = (seconds: number) => (seconds <= 0 ? 0 : Math.min(4, 1 + Math.floor((seconds / peak) * 3.999)));
  return (
    <section className="rhythm">
      <header>
        <strong>{name} · 节奏</strong>
        <small>本月与近半年</small>
      </header>
      <Stats
        items={[
          ["本月", hours(monthTotal)],
          ["今日", hours(daily[now] ?? 0)],
          ["本月推进天数", activeDays + " 天"],
          ["连续", streak + " 天"],
        ]}
      />
      <BarChart
        label="本月每日时长"
        unit=" 分钟"
        points={days.map((d) => ({ x: d, y: daily[d] === undefined ? null : Math.round(daily[d] / 60), done: true }))}
      />
      <div className="heat">
        <div className="heat-caption">
          <span>近半年</span>
          <small>
            少
            {[0, 1, 2, 3, 4].map((l) => (
              <i key={l} data-level={l} />
            ))}
            多
          </small>
        </div>
        <div className="heat-grid">
          {cells.map((d) => (
            <i
              key={d}
              data-level={d > now ? undefined : level(daily[d] ?? 0)}
              className={d > now ? "future" : d === now ? "today" : ""}
              title={d + " · " + hours(daily[d] ?? 0)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
