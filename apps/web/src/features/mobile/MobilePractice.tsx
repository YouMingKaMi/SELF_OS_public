import React, { useEffect, useMemo, useRef, useState } from "react";
import { timeSummary } from "../../../../../modules/practice/index.ts";
import {
  put,
  remove,
  useEntities,
  type AnyEntity as Entity,
} from "../../data/entities.ts";
import { Icon } from "../../ui/Icon.tsx";
import {
  num,
  perform,
  str,
  today,
  usePreference,
} from "../../ui/shared.tsx";
import {
  EventTime,
  Timer,
  controlSession,
  sessionSeconds,
} from "../PracticeTimer.tsx";
import { readingLink } from "../reading-links.ts";
import {
  InkActionSheet,
  InkBarChart,
  InkCard,
  InkChipBar,
  InkComposer,
  InkEmpty,
  InkHairline,
  InkMeter,
  InkNavIcon,
  InkScreen,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkStatRow,
  InkSwitch,
  MobileSubPage,
  MobileToolbar,
  formatSpan,
  shiftDay,
  type ActionSheetItem,
} from "./MobileKit.tsx";
import "./mobile-practice.css";

type PracticeTab = "activities" | "events" | "problems" | "stats";
type ProgressStatus = "pending" | "active" | "resolved" | "discarded";

const EVENT_STATUS_LABELS: Record<ProgressStatus, string> = {
  pending: "待办",
  active: "进行中",
  resolved: "已完成",
  discarded: "已废弃",
};

const PROBLEM_STATUS_LABELS: Record<ProgressStatus, string> = {
  active: "进行中",
  pending: "待推进",
  resolved: "已解决",
  discarded: "已废弃",
};

const SOLUTION_STATUS_LABELS: Record<ProgressStatus, string> = {
  active: "推进中",
  pending: "待推进",
  resolved: "已完成",
  discarded: "已废弃",
};

const PROBLEM_GROUP_ORDER: ProgressStatus[] = [
  "active",
  "pending",
  "resolved",
  "discarded",
];

const MANUAL_PRESETS = [
  { minutes: 15, label: "15分" },
  { minutes: 30, label: "30分" },
  { minutes: 45, label: "45分" },
  { minutes: 60, label: "1小时" },
  { minutes: 90, label: "1.5小时" },
  { minutes: 120, label: "2小时" },
] as const;

function compactDuration(seconds: number): string {
  const mins = Math.max(0, Math.round(seconds / 60));
  if (mins === 0) return "0分";
  if (mins < 60) return `${mins}分`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}m`;
}

function buildSolutionTree(solutions: Entity[]): { e: Entity; depth: number }[] {
  const tree: { e: Entity; depth: number }[] = [];
  const walk = (parentId: string | undefined, depth: number) => {
    for (const s of solutions) {
      if ((str(s, "parentId") || undefined) !== parentId) continue;
      if (tree.some((row) => row.e.id === s.id)) continue;
      tree.push({ e: s, depth });
      walk(s.id, depth + 1);
    }
  };
  walk(undefined, 0);
  for (const s of solutions) {
    if (!tree.some((row) => row.e.id === s.id)) {
      tree.push({ e: s, depth: 0 });
    }
  }
  return tree;
}

function collectDescendantIds(solutions: Entity[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of solutions) {
      const pid = str(s, "parentId");
      if (pid && result.has(pid) && !result.has(s.id)) {
        result.add(s.id);
        changed = true;
      }
    }
  }
  return result;
}

function startOfWeekIso(dayIso: string): string {
  const d = new Date(dayIso + "T12:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // Monday start
  return shiftDay(dayIso, offset);
}

type SheetState =
  | { kind: "domain"; entity?: Entity }
  | { kind: "activity"; entity?: Entity }
  | { kind: "event"; entity?: Entity }
  | { kind: "problem"; entity?: Entity }
  | { kind: "solution"; problem: Entity; entity?: Entity; defaultParentId?: string }
  | {
      kind: "manual";
      defaultActivityId?: string;
      event?: Entity;
      problem?: Entity;
      solution?: Entity;
    }
  | { kind: "editSession"; session: Entity }
  | { kind: "quickProgress" }
  | null;

export function MobilePractice({
  eventRequest,
}: {
  eventRequest?: { id: string };
}) {
  const { entities } = useEntities(
    "domain",
    "activity",
    "problem",
    "solution",
    "session",
    "progress",
    "practiceEvent",
    "readingItem",
  );

  const domains = useMemo(
    () =>
      entities
        .filter((e) => e.type === "domain")
        .sort((a, b) => num(a, "order") - num(b, "order")),
    [entities],
  );

  const [domainId, setDomainId] = usePreference("practice-domain", "");
  const domain = domains.find((e) => e.id === domainId) ?? domains[0];

  const [activityId, setActivityId] = useState("");
  const [tab, setTab] = useState<PracticeTab>("activities");
  const [eventStatusFilter, setEventStatusFilter] = useState<
    "all" | "active" | "pending" | "resolved"
  >("all");
  const [showArchived, setShowArchived] = useState(false);
  const [sessionLimit, setSessionLimit] = useState(20);
  const [progressLimit, setProgressLimit] = useState(30);
  const [starting, setStarting] = useState(false);

  // Sub-page navigation state
  const [detailEventId, setDetailEventId] = useState<string | null>(null);
  const [detailProblemId, setDetailProblemId] = useState<string | null>(null);

  // Action menus & form sheets
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [timerMenuOpen, setTimerMenuOpen] = useState(false);
  const [actionTarget, setActionTarget] = useState<{
    title: string;
    items: ActionSheetItem[];
  } | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);

  // Progress drafts
  const [mainDraft, setMainDraft] = usePreference("practice-progress-draft", "");
  const [eventDrafts, setEventDrafts] = usePreference<Record<string, string>>(
    "practice-event-drafts",
    {},
  );
  const [problemDraft, setProblemDraft] = useState("");

  // Honour eventRequest?.id once the requested event exists in the store
  const consumedReqRef = useRef<{ id: string } | undefined>(undefined);
  const requestedEvent = eventRequest?.id
    ? entities.find(
        (e) => e.type === "practiceEvent" && e.id === eventRequest.id,
      )
    : undefined;

  useEffect(() => {
    if (!eventRequest || !requestedEvent) return;
    if (consumedReqRef.current === eventRequest) return;
    consumedReqRef.current = eventRequest;
    setDomainId(str(requestedEvent, "domainId"));
    setActivityId(str(requestedEvent, "activityId"));
    setTab("events");
    setDetailProblemId(null);
    setDetailEventId(requestedEvent.id);
  }, [eventRequest, requestedEvent, setDomainId]);

  const allActivities = useMemo(
    () =>
      entities.filter(
        (e) => e.type === "activity" && e.data.domainId === domain?.id,
      ),
    [entities, domain?.id],
  );
  const activeActivities = useMemo(
    () => allActivities.filter((e) => !e.data.archived),
    [allActivities],
  );
  const archivedActivities = useMemo(
    () => allActivities.filter((e) => Boolean(e.data.archived)),
    [allActivities],
  );
  const selectedActivity = activeActivities.find((e) => e.id === activityId);

  const domainEvents = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            e.type === "practiceEvent" &&
            e.data.domainId === domain?.id &&
            (!selectedActivity || e.data.activityId === selectedActivity.id),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entities, domain?.id, selectedActivity],
  );

  const filteredEvents = useMemo(() => {
    if (eventStatusFilter === "all") return domainEvents;
    return domainEvents.filter((e) => str(e, "status") === eventStatusFilter);
  }, [domainEvents, eventStatusFilter]);

  const domainProblems = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            e.type === "problem" &&
            e.data.domainId === domain?.id &&
            (!selectedActivity || e.data.activityId === selectedActivity.id),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [entities, domain?.id, selectedActivity],
  );

  const domainSessions = useMemo(
    () =>
      entities.filter(
        (e) => e.type === "session" && e.data.domainId === domain?.id,
      ),
    [entities, domain?.id],
  );

  const running = useMemo(
    () =>
      entities.find(
        (e) =>
          e.type === "session" &&
          ["running", "paused"].includes(str(e, "status")),
      ),
    [entities],
  );

  const domainLogs = useMemo(
    () =>
      entities
        .filter(
          (e) =>
            e.type === "progress" &&
            e.data.domainId === domain?.id &&
            (!selectedActivity || e.data.activityId === selectedActivity.id),
        )
        .sort((a, b) => {
          const dayCmp = str(b, "day").localeCompare(str(a, "day"));
          return dayCmp !== 0 ? dayCmp : b.updatedAt.localeCompare(a.updatedAt);
        }),
    [entities, domain?.id, selectedActivity],
  );

  const allSolutions = useMemo(
    () => entities.filter((e) => e.type === "solution"),
    [entities],
  );

  const todayIso = today();
  const monthPrefix = todayIso.slice(0, 7);
  const weekStart = startOfWeekIso(todayIso);

  const summary = useMemo(
    () => timeSummary(domainSessions, Date.now()),
    [domainSessions],
  );

  const todaySeconds = summary.daily[todayIso] ?? 0;
  const weekSeconds = useMemo(
    () =>
      Object.entries(summary.daily)
        .filter(([d]) => d >= weekStart && d <= todayIso)
        .reduce((acc, [, s]) => acc + s, 0),
    [summary.daily, weekStart, todayIso],
  );
  const monthSeconds = useMemo(
    () =>
      Object.entries(summary.daily)
        .filter(([d]) => d.startsWith(monthPrefix))
        .reduce((acc, [, s]) => acc + s, 0),
    [summary.daily, monthPrefix],
  );

  const last14Days = useMemo(
    () => Array.from({ length: 14 }, (_, i) => shiftDay(todayIso, i - 13)),
    [todayIso],
  );

  const chartPoints = useMemo(
    () =>
      last14Days.map((day) => ({
        x: day,
        y: Math.round((summary.daily[day] ?? 0) / 60),
        highlight: day === todayIso,
        label: `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`,
      })),
    [last14Days, summary.daily, todayIso],
  );

  const sortedRecentSessions = useMemo(
    () =>
      [...domainSessions].sort((a, b) => {
        const d = str(b, "day").localeCompare(str(a, "day"));
        return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
      }),
    [domainSessions],
  );

  const activityBreakdown = useMemo(
    () =>
      activeActivities
        .map((act) => {
          const s = timeSummary(
            domainSessions.filter((x) => x.data.activityId === act.id),
            Date.now(),
          );
          const sec = Object.entries(s.daily)
            .filter(([d]) => d.startsWith(monthPrefix))
            .reduce((acc, [, v]) => acc + v, 0);
          return { activity: act, seconds: sec };
        })
        .sort((a, b) => b.seconds - a.seconds),
    [activeActivities, domainSessions, monthPrefix],
  );

  const detailEvent = detailEventId
    ? entities.find(
        (e) => e.type === "practiceEvent" && e.id === detailEventId,
      )
    : undefined;
  const detailProblem = detailProblemId
    ? entities.find((e) => e.type === "problem" && e.id === detailProblemId)
    : undefined;

  async function startSession(opts?: {
    activity?: Entity;
    event?: Entity;
    problem?: Entity;
    solution?: Entity;
  }) {
    if (!domain || running || starting) return;
    const ev = opts?.event;
    if (ev && ["resolved", "discarded"].includes(str(ev, "status"))) return;
    const prob = ev ? undefined : opts?.problem;
    const sol = prob ? opts?.solution : undefined;
    const actId = ev
      ? str(ev, "activityId")
      : prob
        ? str(prob, "activityId")
        : opts?.activity
          ? opts.activity.id
          : selectedActivity?.id ?? "";
    const act = allActivities.find((a) => a.id === actId);
    const title = (
      ev
        ? str(ev, "title")
        : sol
          ? str(sol, "title")
          : prob
            ? str(prob, "title")
            : act
              ? str(act, "name")
              : str(domain, "name")
    ).slice(0, 500);

    const now = new Date().toISOString();
    setStarting(true);
    try {
      await put("session", {
        domainId: domain.id,
        ...(actId ? { activityId: actId } : {}),
        ...(ev ? { eventId: ev.id } : {}),
        ...(prob ? { problemId: prob.id } : {}),
        ...(sol ? { solutionId: sol.id } : {}),
        title,
        day: today(),
        startedAt: now,
        runningSince: now,
        elapsedSeconds: 0,
        segments: [],
        status: "running",
        manual: false,
      });
    } finally {
      setStarting(false);
    }
  }

  async function saveMainProgress(text: string) {
    if (!domain || !text.trim()) return;
    await put("progress", {
      domainId: domain.id,
      ...(selectedActivity ? { activityId: selectedActivity.id } : {}),
      day: today(),
      body: text.trim(),
    });
    setMainDraft("");
  }

  function placeLabel(log: Entity): string {
    const evId = str(log, "eventId");
    if (evId) {
      const ev = entities.find((e) => e.type === "practiceEvent" && e.id === evId);
      if (ev) return `事件 · ${str(ev, "title")}`;
    }
    const probId = str(log, "problemId");
    if (probId) {
      const prob = entities.find((e) => e.type === "problem" && e.id === probId);
      const solId = str(log, "solutionId");
      const sol = solId
        ? allSolutions.find((s) => s.id === solId)
        : undefined;
      if (prob) {
        return sol
          ? `${str(prob, "title")} / ${str(sol, "title")}`
          : str(prob, "title");
      }
    }
    const actId = str(log, "activityId");
    if (actId) {
      const act = allActivities.find((a) => a.id === actId);
      if (act) return str(act, "name");
    }
    return "领域记录";
  }

  function renderLiveHero(session: Entity) {
    const isRunning = session.data.status === "running";
    const sessionDomain = domains.find((d) => d.id === session.data.domainId);
    return (
      <InkCard>
        <div className="mp-live-status">
          <span className={"mp-live-dot" + (isRunning ? " active" : "")} />
          <span>{isRunning ? "正在推进" : "已暂停"}</span>
          {sessionDomain && (
            <span className="mp-live-domain">
              · {str(sessionDomain, "name")}
            </span>
          )}
        </div>
        <h3 className="mp-hero-title">{str(session, "title")}</h3>
        <div className="mp-live-controls">
          <div className={"mp-live-clock" + (isRunning ? "" : " paused")}>
            <Timer session={session} />
          </div>
          <div className="mp-live-btns">
            <button
              type="button"
              className="mp-circle-btn subtle"
              aria-label="本次计时选项"
              onClick={() => setTimerMenuOpen(true)}
            >
              <Icon name="ellipsis" size={18} />
            </button>
            <button
              type="button"
              className="mp-circle-btn play"
              aria-label={isRunning ? "暂停" : "继续"}
              onClick={() =>
                perform(
                  controlSession(session, isRunning ? "pause" : "resume"),
                )
              }
            >
              <Icon name={isRunning ? "pause" : "play"} size={20} />
            </button>
          </div>
        </div>
      </InkCard>
    );
  }

  // ─────────────────────────── Event Detail SubPage ───────────────────────────
  if (detailEvent && domain) {
    const evStatus = (str(detailEvent, "status", "active") as ProgressStatus);
    const evActId = str(detailEvent, "activityId");
    const evAct = allActivities.find((a) => a.id === evActId);
    const evSessions = domainSessions
      .filter((s) => s.data.eventId === detailEvent.id)
      .sort((a, b) => str(b, "day").localeCompare(str(a, "day")));
    const evLogs = entities
      .filter(
        (e) => e.type === "progress" && e.data.eventId === detailEvent.id,
      )
      .sort((a, b) => {
        const d = str(b, "day").localeCompare(str(a, "day"));
        return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
      });
    const evTotalSeconds = timeSummary(evSessions, Date.now()).totalSeconds;
    const source = detailEvent.data.readingItemId
      ? entities.find(
          (e) =>
            e.type === "readingItem" && e.id === detailEvent.data.readingItemId,
        )
      : undefined;
    const sourceUrl =
      source &&
      (readingLink(str(source, "note")) ?? readingLink(str(source, "title")));
    const evDraft = eventDrafts[detailEvent.id] ?? "";
    const setEvDraft = (v: string) => {
      const next = { ...eventDrafts };
      if (v) next[detailEvent.id] = v;
      else delete next[detailEvent.id];
      setEventDrafts(next);
    };
    const isThisEventRunning = running && running.data.eventId === detailEvent.id;
    const canStartEvent =
      !running && !["resolved", "discarded"].includes(evStatus);

    return (
      <MobileSubPage
        title={str(detailEvent, "title")}
        backLabel="推进台"
        onBack={() => setDetailEventId(null)}
        right={
          <>
            <InkNavIcon
              icon="edit"
              label="编辑事件"
              onClick={() => setSheet({ kind: "event", entity: detailEvent })}
            />
            <InkNavIcon
              icon="ellipsis"
              label="事件操作"
              onClick={() =>
                setActionTarget({
                  title: str(detailEvent, "title"),
                  items: [
                    {
                      label: "编辑事件",
                      icon: "edit",
                      onClick: () =>
                        setSheet({ kind: "event", entity: detailEvent }),
                    },
                    {
                      label: "补录时长",
                      icon: "clock",
                      onClick: () =>
                        setSheet({
                          kind: "manual",
                          event: detailEvent,
                          defaultActivityId: evActId,
                        }),
                    },
                    {
                      label: "删除事件",
                      icon: "trash",
                      danger: true,
                      onClick: () => {
                        perform(remove(detailEvent));
                        setDetailEventId(null);
                      },
                    },
                  ],
                })
              }
            />
          </>
        }
      >
        <InkScreen hasComposer>
          {isThisEventRunning && running && renderLiveHero(running)}

          <InkCard>
            <div className="mp-idle-head">
              <div className="mp-idle-copy">
                <h3 className="mp-hero-title">{str(detailEvent, "title")}</h3>
                <p className="mp-hero-sub">
                  {str(domain, "name")}
                  {evAct ? ` / ${str(evAct, "name")}` : ""}
                </p>
              </div>
              {!isThisEventRunning && (
                <button
                  type="button"
                  className="mp-circle-btn play"
                  aria-label="开始推进此事件"
                  disabled={!canStartEvent || starting}
                  onClick={() => perform(startSession({ event: detailEvent }))}
                >
                  <Icon name="play" size={20} />
                </button>
              )}
            </div>

            <InkChipBar
              size="sm"
              value={evStatus}
              items={(
                ["pending", "active", "resolved", "discarded"] as const
              ).map((st) => ({
                value: st,
                label: EVENT_STATUS_LABELS[st],
              }))}
              onChange={(nextStatus) =>
                perform(
                  put(
                    "practiceEvent",
                    {
                      domainId: str(detailEvent, "domainId"),
                      ...(evActId ? { activityId: evActId } : {}),
                      ...(detailEvent.data.readingItemId
                        ? { readingItemId: str(detailEvent, "readingItemId") }
                        : {}),
                      title: str(detailEvent, "title"),
                      note: str(detailEvent, "note"),
                      status: nextStatus,
                    },
                    detailEvent,
                  ),
                )
              }
            />

            {str(detailEvent, "note").trim() && (
              <p className="mp-note-body">{str(detailEvent, "note")}</p>
            )}

            {source && (
              <div className="mp-source-box">
                <span>研究收藏 · {str(source, "title")}</span>
                {sourceUrl && (
                  <a
                    className="mp-source-link"
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开原文 ↗
                  </a>
                )}
              </div>
            )}

            <InkHairline />

            <InkStatRow
              items={[
                { label: "累计时长", value: compactDuration(evTotalSeconds) },
                {
                  label: "计时次数",
                  value: `${evSessions.filter((s) => s.data.status !== "cancelled").length} 次`,
                },
                { label: "进展记录", value: `${evLogs.length} 条` },
              ]}
            />
          </InkCard>

          <InkCard>
            <div className="mp-card-head">
              <span className="mp-card-head-title">进展记录</span>
              <span className="mp-card-head-meta">{evLogs.length} 条</span>
            </div>
            {evLogs.length === 0 ? (
              <InkEmpty text="在底部写下这个阶段的每一步进展。" />
            ) : (
              <div>
                {evLogs.map((log, idx) => (
                  <React.Fragment key={log.id}>
                    {idx > 0 && <InkHairline inset={44} />}
                    <div className="mp-log-row">
                      <div className="mp-log-date">
                        <strong>{Number(str(log, "day").slice(8, 10)) || 0}</strong>
                        <small>{Number(str(log, "day").slice(5, 7)) || 0}月</small>
                      </div>
                      <div className="mp-log-main">
                        <p className="mp-log-text">{str(log, "body")}</p>
                      </div>
                      <button
                        type="button"
                        className="mp-circle-btn mini"
                        aria-label="更多操作"
                        onClick={() =>
                          setActionTarget({
                            title: "进展记录",
                            items: [
                              {
                                label: "删除这条进展",
                                icon: "trash",
                                danger: true,
                                onClick: () => perform(remove(log)),
                              },
                            ],
                          })
                        }
                      >
                        <Icon name="ellipsis" size={14} />
                      </button>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </InkCard>

          <InkCard>
            <div className="mp-card-head">
              <span className="mp-card-head-title">关联计时</span>
              <button
                type="button"
                className="mk-text-btn accent"
                onClick={() =>
                  setSheet({
                    kind: "manual",
                    event: detailEvent,
                    defaultActivityId: evActId,
                  })
                }
              >
                + 补录
              </button>
            </div>
            {evSessions.length === 0 ? (
              <InkEmpty text="还没有关联的计时记录。" />
            ) : (
              <div>
                {evSessions.map((s, idx) => (
                  <React.Fragment key={s.id}>
                    {idx > 0 && <InkHairline />}
                    <button
                      type="button"
                      className={
                        "mp-session-row" +
                        (s.data.status === "cancelled" ? " cancelled" : "")
                      }
                      onClick={() => setSheet({ kind: "editSession", session: s })}
                    >
                      <span className="mp-session-day">
                        {str(s, "day").slice(5)}
                      </span>
                      <span className="mk-row-main">
                        <span className="mk-row-title clamp-1">
                          {str(s, "title")}
                        </span>
                        <span className="mk-row-sub">
                          {s.data.status === "cancelled"
                            ? "已取消"
                            : s.data.manual
                              ? "补录时长"
                              : "计时记录"}
                        </span>
                      </span>
                      <span className="mp-session-val">
                        {formatSpan(sessionSeconds(s))}
                      </span>
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}
          </InkCard>

          <InkComposer
            value={evDraft}
            onChange={setEvDraft}
            placeholder="记一条事件进展…"
            onSubmit={() => {
              if (!evDraft.trim()) return;
              perform(
                put("progress", {
                  domainId: str(detailEvent, "domainId"),
                  ...(evActId ? { activityId: evActId } : {}),
                  eventId: detailEvent.id,
                  day: today(),
                  body: evDraft.trim(),
                }).then(() => setEvDraft("")),
              );
            }}
          />
        </InkScreen>

        {renderSharedModals()}
      </MobileSubPage>
    );
  }

  // ─────────────────────────── Problem Detail SubPage ───────────────────────────
  if (detailProblem && domain) {
    const probStatus = str(detailProblem, "status", "active") as ProgressStatus;
    const probActId = str(detailProblem, "activityId");
    const probAct = allActivities.find((a) => a.id === probActId);
    const probSolutions = allSolutions.filter(
      (s) => s.data.problemId === detailProblem.id,
    );
    const solTree = buildSolutionTree(probSolutions);
    const probLogs = entities
      .filter(
        (e) => e.type === "progress" && e.data.problemId === detailProblem.id,
      )
      .sort((a, b) => {
        const d = str(b, "day").localeCompare(str(a, "day"));
        return d !== 0 ? d : b.updatedAt.localeCompare(a.updatedAt);
      });
    const probSessions = domainSessions.filter(
      (s) => s.data.problemId === detailProblem.id,
    );
    const probSeconds = timeSummary(probSessions, Date.now()).totalSeconds;
    const isThisProbRunning =
      running && running.data.problemId === detailProblem.id;

    return (
      <MobileSubPage
        title={str(detailProblem, "title")}
        backLabel="推进台"
        onBack={() => setDetailProblemId(null)}
        right={
          <>
            <InkNavIcon
              icon="edit"
              label="编辑问题"
              onClick={() =>
                setSheet({ kind: "problem", entity: detailProblem })
              }
            />
            <InkNavIcon
              icon="plus"
              label="添加方案"
              onClick={() =>
                setSheet({ kind: "solution", problem: detailProblem })
              }
            />
          </>
        }
      >
        <InkScreen hasComposer>
          {isThisProbRunning && running && renderLiveHero(running)}

          <InkCard>
            <div className="mp-idle-head">
              <div className="mp-idle-copy">
                <h3 className="mp-hero-title">{str(detailProblem, "title")}</h3>
                <p className="mp-hero-sub">
                  {str(domain, "name")}
                  {probAct ? ` / ${str(probAct, "name")}` : ""}
                </p>
              </div>
              {!isThisProbRunning && (
                <button
                  type="button"
                  className="mp-circle-btn play"
                  aria-label="推进此问题"
                  disabled={Boolean(running) || starting}
                  onClick={() =>
                    perform(startSession({ problem: detailProblem }))
                  }
                >
                  <Icon name="play" size={20} />
                </button>
              )}
            </div>

            <InkChipBar
              size="sm"
              value={probStatus}
              items={PROBLEM_GROUP_ORDER.map((st) => ({
                value: st,
                label: PROBLEM_STATUS_LABELS[st],
              }))}
              onChange={(nextStatus) =>
                perform(
                  put(
                    "problem",
                    { ...detailProblem.data, status: nextStatus },
                    detailProblem,
                  ),
                )
              }
            />

            {str(detailProblem, "note").trim() ? (
              <p className="mp-note-body">{str(detailProblem, "note")}</p>
            ) : (
              <p className="mp-hint">
                可点右上角编辑补充问题背景、当前判断与下一步。
              </p>
            )}

            <InkHairline />

            <InkStatRow
              items={[
                { label: "方案数", value: `${probSolutions.length}` },
                { label: "进展记录", value: `${probLogs.length} 条` },
                { label: "投入时长", value: compactDuration(probSeconds) },
              ]}
            />
          </InkCard>

          <InkCard>
            <div className="mp-card-head">
              <span className="mp-card-head-title">方案树</span>
              <button
                type="button"
                className="mk-text-btn accent"
                onClick={() =>
                  setSheet({ kind: "solution", problem: detailProblem })
                }
              >
                + 添加方案
              </button>
            </div>
            {solTree.length === 0 ? (
              <InkEmpty text="还没有方案；也可以直接推进问题本身。" />
            ) : (
              <div>
                {solTree.map(({ e: sol, depth }, idx) => {
                  const st = str(sol, "status", "active") as ProgressStatus;
                  const indent = Math.min(depth, 4) * 16;
                  return (
                    <React.Fragment key={sol.id}>
                      {idx > 0 && <InkHairline />}
                      <div className="mp-sol-branch">
                        {depth > 0 && (
                          <span
                            className="mp-sol-guide"
                            style={{ left: `${indent - 8}px` }}
                          />
                        )}
                        <div
                          className="mp-sol-row"
                          style={{ paddingLeft: `${indent}px` }}
                        >
                          <button
                            type="button"
                            className="mp-sol-dot-btn"
                            aria-label="切换方案状态"
                            onClick={() =>
                              perform(
                                put(
                                  "solution",
                                  {
                                    ...sol.data,
                                    status:
                                      st === "resolved" ? "active" : "resolved",
                                  },
                                  sol,
                                ),
                              )
                            }
                          >
                            <span className={`mp-status-dot ${st}`} />
                          </button>
                          <button
                            type="button"
                            className="mp-sol-hit"
                            onClick={() =>
                              setActionTarget({
                                title: str(sol, "title"),
                                items: [
                                  {
                                    label:
                                      st === "resolved"
                                        ? "标记为推进中"
                                        : "标记为已完成",
                                    icon: "check",
                                    onClick: () =>
                                      perform(
                                        put(
                                          "solution",
                                          {
                                            ...sol.data,
                                            status:
                                              st === "resolved"
                                                ? "active"
                                                : "resolved",
                                          },
                                          sol,
                                        ),
                                      ),
                                  },
                                  ...(!running
                                    ? [
                                        {
                                          label: "沿此方案开始计时",
                                          icon: "play",
                                          onClick: () =>
                                            perform(
                                              startSession({
                                                problem: detailProblem,
                                                solution: sol,
                                              }),
                                            ),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: "在此下添加子方案",
                                    icon: "plus",
                                    onClick: () =>
                                      setSheet({
                                        kind: "solution",
                                        problem: detailProblem,
                                        defaultParentId: sol.id,
                                      }),
                                  },
                                  {
                                    label: "编辑方案",
                                    icon: "edit",
                                    onClick: () =>
                                      setSheet({
                                        kind: "solution",
                                        problem: detailProblem,
                                        entity: sol,
                                      }),
                                  },
                                  {
                                    label: "删除方案",
                                    icon: "trash",
                                    danger: true,
                                    onClick: () => perform(remove(sol)),
                                  },
                                ],
                              })
                            }
                          >
                            <span
                              className={
                                "mp-item-title" +
                                (st === "discarded"
                                  ? " strike"
                                  : st === "resolved"
                                    ? " muted"
                                    : "")
                              }
                            >
                              {str(sol, "title")}
                            </span>
                            <span className="mp-item-meta">
                              {SOLUTION_STATUS_LABELS[st] ?? st}
                            </span>
                            {str(sol, "reason").trim() && (
                              <p className="mp-sol-reason">
                                {str(sol, "reason")}
                              </p>
                            )}
                          </button>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </InkCard>

          <InkCard>
            <div className="mp-card-head">
              <span className="mp-card-head-title">进展记录</span>
              <span className="mp-card-head-meta">{probLogs.length} 条</span>
            </div>
            {probLogs.length === 0 ? (
              <InkEmpty text="在底部记下排查与推进的发现。" />
            ) : (
              <div>
                {probLogs.map((log, idx) => (
                  <React.Fragment key={log.id}>
                    {idx > 0 && <InkHairline inset={44} />}
                    <div className="mp-log-row">
                      <div className="mp-log-date">
                        <strong>{Number(str(log, "day").slice(8, 10)) || 0}</strong>
                        <small>{Number(str(log, "day").slice(5, 7)) || 0}月</small>
                      </div>
                      <div className="mp-log-main">
                        <p className="mp-log-text">{str(log, "body")}</p>
                        {str(log, "solutionId") && (
                          <span className="mp-log-place">
                            {str(
                              probSolutions.find(
                                (s) => s.id === log.data.solutionId,
                              ),
                              "title",
                            )}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="mp-circle-btn mini"
                        aria-label="更多操作"
                        onClick={() =>
                          setActionTarget({
                            title: "进展记录",
                            items: [
                              {
                                label: "删除这条进展",
                                icon: "trash",
                                danger: true,
                                onClick: () => perform(remove(log)),
                              },
                            ],
                          })
                        }
                      >
                        <Icon name="ellipsis" size={14} />
                      </button>
                    </div>
                  </React.Fragment>
                ))}
              </div>
            )}
          </InkCard>

          <InkComposer
            value={problemDraft}
            onChange={setProblemDraft}
            placeholder="记一条问题进展…"
            onSubmit={() => {
              if (!problemDraft.trim()) return;
              perform(
                put("progress", {
                  domainId: str(detailProblem, "domainId"),
                  ...(probActId ? { activityId: probActId } : {}),
                  problemId: detailProblem.id,
                  day: today(),
                  body: problemDraft.trim(),
                }).then(() => setProblemDraft("")),
              );
            }}
          />
        </InkScreen>

        {renderSharedModals()}
      </MobileSubPage>
    );
  }

  // ─────────────────────────── Shared Sheets & Action Menus ───────────────────────────
  function renderSharedModals() {
    return (
      <>
        <InkActionSheet
          open={moreMenuOpen}
          title={domain ? str(domain, "name") : "领域管理"}
          onClose={() => setMoreMenuOpen(false)}
          items={[
            ...(domain
              ? [
                  {
                    label: "编辑领域",
                    icon: "edit",
                    onClick: () => setSheet({ kind: "domain", entity: domain }),
                  },
                ]
              : []),
            {
              label: "新建领域",
              icon: "plus",
              onClick: () => setSheet({ kind: "domain" }),
            },
            ...(domain
              ? [
                  {
                    label: "补录时长",
                    icon: "clock",
                    onClick: () =>
                      setSheet({
                        kind: "manual",
                        defaultActivityId: selectedActivity?.id,
                      }),
                  },
                  {
                    label: "添加子领域",
                    icon: "folder",
                    onClick: () => setSheet({ kind: "activity" }),
                  },
                ]
              : []),
          ]}
        />

        <InkActionSheet
          open={plusMenuOpen}
          title="快速新建"
          onClose={() => setPlusMenuOpen(false)}
          items={
            domain
              ? [
                  {
                    label: "新建子领域",
                    icon: "folder",
                    onClick: () => setSheet({ kind: "activity" }),
                  },
                  {
                    label: "新建事件",
                    icon: "pin",
                    onClick: () => setSheet({ kind: "event" }),
                  },
                  {
                    label: "新建问题",
                    icon: "alert",
                    onClick: () => setSheet({ kind: "problem" }),
                  },
                  {
                    label: "记一条进展",
                    icon: "edit",
                    onClick: () => setSheet({ kind: "quickProgress" }),
                  },
                ]
              : [
                  {
                    label: "新建领域",
                    icon: "plus",
                    onClick: () => setSheet({ kind: "domain" }),
                  },
                ]
          }
        />

        <InkActionSheet
          open={timerMenuOpen && Boolean(running)}
          title={running ? str(running, "title") : undefined}
          onClose={() => setTimerMenuOpen(false)}
          items={
            running
              ? [
                  {
                    label: "完成并保存",
                    icon: "stop",
                    onClick: () => perform(controlSession(running, "finish")),
                  },
                  {
                    label: "取消本次",
                    icon: "close",
                    danger: true,
                    onClick: () => perform(controlSession(running, "cancel")),
                  },
                ]
              : []
          }
        />

        <InkActionSheet
          open={actionTarget !== null}
          title={actionTarget?.title}
          items={actionTarget?.items ?? []}
          onClose={() => setActionTarget(null)}
        />

        {sheet?.kind === "domain" && (
          <DomainSheet
            entity={sheet.entity}
            nextOrder={domains.length}
            onClose={() => setSheet(null)}
            onSaved={(id) => {
              if (!sheet.entity) {
                setDomainId(id);
                setActivityId("");
              }
              setSheet(null);
            }}
            onDeleted={() => {
              if (sheet.entity?.id === domain?.id) {
                const fallback = domains.find((d) => d.id !== sheet.entity?.id);
                setDomainId(fallback?.id ?? "");
                setActivityId("");
              }
              setSheet(null);
            }}
          />
        )}

        {sheet?.kind === "activity" && domain && (
          <ActivitySheet
            domainId={domain.id}
            entity={sheet.entity}
            onClose={() => setSheet(null)}
            onSaved={(id, archived) => {
              if (archived && id === activityId) setActivityId("");
              setSheet(null);
            }}
            onDeleted={() => {
              if (sheet.entity?.id === activityId) setActivityId("");
              setSheet(null);
            }}
          />
        )}

        {sheet?.kind === "event" && domain && (
          <EventSheet
            domainId={domain.id}
            activities={activeActivities}
            defaultActivityId={selectedActivity?.id ?? ""}
            entity={sheet.entity}
            onClose={() => setSheet(null)}
            onSaved={(id) => {
              setSheet(null);
              if (!sheet.entity) {
                setTab("events");
                setDetailEventId(id);
              }
            }}
            onDeleted={() => {
              if (sheet.entity?.id === detailEventId) setDetailEventId(null);
              setSheet(null);
            }}
          />
        )}

        {sheet?.kind === "problem" && domain && (
          <ProblemSheet
            domainId={domain.id}
            activities={activeActivities}
            defaultActivityId={selectedActivity?.id ?? ""}
            entity={sheet.entity}
            onClose={() => setSheet(null)}
            onSaved={(id) => {
              setSheet(null);
              if (!sheet.entity) {
                setTab("problems");
                setDetailProblemId(id);
              }
            }}
            onDeleted={() => {
              if (sheet.entity?.id === detailProblemId)
                setDetailProblemId(null);
              setSheet(null);
            }}
          />
        )}

        {sheet?.kind === "solution" && (
          <SolutionSheet
            problem={sheet.problem}
            solutions={allSolutions.filter(
              (s) => s.data.problemId === sheet.problem.id,
            )}
            entity={sheet.entity}
            defaultParentId={sheet.defaultParentId}
            onClose={() => setSheet(null)}
          />
        )}

        {sheet?.kind === "manual" && domain && (
          <ManualSessionSheet
            domain={domain}
            activities={activeActivities}
            defaultActivityId={sheet.defaultActivityId}
            event={sheet.event}
            problem={sheet.problem}
            solution={sheet.solution}
            onClose={() => setSheet(null)}
          />
        )}

        {sheet?.kind === "editSession" && (
          <EditSessionSheet
            session={sheet.session}
            onClose={() => setSheet(null)}
          />
        )}

        {sheet?.kind === "quickProgress" && domain && (
          <QuickProgressSheet
            domain={domain}
            activity={selectedActivity}
            onClose={() => setSheet(null)}
          />
        )}
      </>
    );
  }

  // ─────────────────────────── Main Practice View ───────────────────────────
  const activeProblemCount = domainProblems.filter(
    (p) => str(p, "status") === "active",
  ).length;
  const activeEventCount = domainEvents.filter(
    (e) => str(e, "status") === "active",
  ).length;

  return (
    <InkScreen hasComposer={Boolean(domain)}>
      <MobileToolbar>
        <InkNavIcon
          icon="ellipsis"
          label="更多选项"
          onClick={() => setMoreMenuOpen(true)}
        />
        <InkNavIcon
          icon="plus"
          label="快速新建"
          onClick={() => setPlusMenuOpen(true)}
        />
      </MobileToolbar>

      {domains.length > 0 && (
        <InkChipBar
          items={domains.map((d) => ({
            value: d.id,
            label: str(d, "name"),
          }))}
          value={domain?.id ?? ""}
          onChange={(id) => {
            setDomainId(id);
            setActivityId("");
            setDetailEventId(null);
            setDetailProblemId(null);
            setSessionLimit(20);
            setProgressLimit(30);
          }}
        />
      )}

      {!domain ? (
        <InkCard>
          <InkEmpty text="添加你的第一个领域，例如 AI、健身或自动化" />
          <button
            type="button"
            className="mk-pill solid full"
            onClick={() => setSheet({ kind: "domain" })}
          >
            新建领域
          </button>
        </InkCard>
      ) : (
        <>
          {/* Live Timer or Idle Start Hero */}
          {running ? (
            renderLiveHero(running)
          ) : (
            <InkCard>
              <div className="mp-idle-head">
                <div className="mp-idle-copy">
                  <h3 className="mp-hero-title">
                    {selectedActivity
                      ? str(selectedActivity, "name")
                      : str(domain, "name")}
                  </h3>
                  <p className="mp-hero-sub">
                    {selectedActivity
                      ? `${str(domain, "name")} · 子领域推进`
                      : str(domain, "goal").trim() || "直接推进这个领域"}
                  </p>
                </div>
                <button
                  type="button"
                  className="mp-circle-btn play"
                  aria-label="开始推进"
                  disabled={starting}
                  onClick={() => perform(startSession())}
                >
                  <Icon name="play" size={20} />
                </button>
              </div>

              {activeActivities.length > 0 && (
                <InkChipBar
                  size="sm"
                  value={selectedActivity?.id ?? ""}
                  items={[
                    { value: "", label: "整个领域" },
                    ...activeActivities.map((a) => ({
                      value: a.id,
                      label: str(a, "name"),
                    })),
                  ]}
                  onChange={(id) => setActivityId(id)}
                />
              )}

              <InkHairline />

              <InkStatRow
                items={[
                  { label: "今日", value: compactDuration(todaySeconds) },
                  { label: "本月", value: compactDuration(monthSeconds) },
                  {
                    label: "进行中",
                    value: `${activeEventCount + activeProblemCount} 项`,
                  },
                ]}
              />
            </InkCard>
          )}

          {/* 4-tab InkSegmented */}
          <InkSegmented<PracticeTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: "activities", label: "子领域" },
              { value: "events", label: "事件" },
              { value: "problems", label: "问题" },
              { value: "stats", label: "统计" },
            ]}
          />

          {/* Tab 1: 子领域 */}
          {tab === "activities" && (
            <>
              <InkCard variant="compact">
                {activeActivities.length === 0 ? (
                  <div style={{ padding: "14px 0" }}>
                    <InkEmpty text="还没有子领域，点右上角 + 添加，或直接推进整个领域。" />
                  </div>
                ) : (
                  activeActivities.map((act, idx) => {
                    const isSelected = selectedActivity?.id === act.id;
                    const actSec =
                      activityBreakdown.find((b) => b.activity.id === act.id)
                        ?.seconds ?? 0;
                    const probCount = entities.filter(
                      (e) =>
                        e.type === "problem" &&
                        e.data.activityId === act.id &&
                        e.data.status === "active",
                    ).length;
                    const evCount = entities.filter(
                      (e) =>
                        e.type === "practiceEvent" &&
                        e.data.activityId === act.id &&
                        e.data.status === "active",
                    ).length;
                    return (
                      <React.Fragment key={act.id}>
                        {idx > 0 && <InkHairline />}
                        <div className="mp-activity-row">
                          <button
                            type="button"
                            className="mp-activity-hit"
                            onClick={() =>
                              setActivityId(isSelected ? "" : act.id)
                            }
                          >
                            <div className="mp-activity-top">
                              <span
                                className={
                                  "mp-activity-name" +
                                  (isSelected ? " selected" : "")
                                }
                              >
                                {str(act, "name")}
                              </span>
                              {isSelected && (
                                <span className="mp-active-tag">已选中</span>
                              )}
                            </div>
                            <div className="mp-activity-meta">
                              <span>
                                {evCount > 0 || probCount > 0
                                  ? `${evCount} 事件 · ${probCount} 问题`
                                  : "点击筛选或直接计时"}
                              </span>
                              <span>本月 {compactDuration(actSec)}</span>
                            </div>
                            {monthSeconds > 0 && actSec > 0 && (
                              <InkMeter progress={actSec / monthSeconds} />
                            )}
                          </button>
                          <div className="mp-activity-actions">
                            {!running && (
                              <button
                                type="button"
                                className="mp-circle-btn mini"
                                aria-label={`开始推进 ${str(act, "name")}`}
                                disabled={starting}
                                onClick={() =>
                                  perform(startSession({ activity: act }))
                                }
                              >
                                <Icon name="play" size={12} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="mp-circle-btn mini"
                              aria-label={`${str(act, "name")} 操作`}
                              onClick={() =>
                                setActionTarget({
                                  title: str(act, "name"),
                                  items: [
                                    ...(!running
                                      ? [
                                          {
                                            label: "开始推进此子领域",
                                            icon: "play",
                                            onClick: () =>
                                              perform(
                                                startSession({ activity: act }),
                                              ),
                                          },
                                        ]
                                      : []),
                                    {
                                      label: isSelected
                                        ? "取消筛选此子领域"
                                        : "按此子领域筛选",
                                      icon: "filter",
                                      onClick: () =>
                                        setActivityId(isSelected ? "" : act.id),
                                    },
                                    {
                                      label: "编辑名称",
                                      icon: "edit",
                                      onClick: () =>
                                        setSheet({
                                          kind: "activity",
                                          entity: act,
                                        }),
                                    },
                                    {
                                      label: "归档子领域",
                                      icon: "folder",
                                      onClick: () => {
                                        if (activityId === act.id)
                                          setActivityId("");
                                        perform(
                                          put(
                                            "activity",
                                            { ...act.data, archived: true },
                                            act,
                                          ),
                                        );
                                      },
                                    },
                                    {
                                      label: "删除子领域",
                                      icon: "trash",
                                      danger: true,
                                      onClick: () => {
                                        if (activityId === act.id)
                                          setActivityId("");
                                        perform(remove(act));
                                      },
                                    },
                                  ],
                                })
                              }
                            >
                              <Icon name="ellipsis" size={14} />
                            </button>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })
                )}
              </InkCard>

              {archivedActivities.length > 0 && (
                <div>
                  <button
                    type="button"
                    className="mp-disclosure"
                    onClick={() => setShowArchived((v) => !v)}
                  >
                    <span>已归档子领域 ({archivedActivities.length})</span>
                    <Icon
                      name={showArchived ? "chevron-up" : "chevron-down"}
                      size={15}
                    />
                  </button>
                  {showArchived && (
                    <InkCard variant="compact">
                      {archivedActivities.map((act, idx) => (
                        <React.Fragment key={act.id}>
                          {idx > 0 && <InkHairline />}
                          <div className="mp-activity-row">
                            <div className="mp-activity-hit">
                              <span
                                className="mp-activity-name"
                                style={{ color: "var(--text-3)" }}
                              >
                                {str(act, "name")}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="mk-pill sm"
                              onClick={() =>
                                perform(
                                  put(
                                    "activity",
                                    { ...act.data, archived: false },
                                    act,
                                  ),
                                )
                              }
                            >
                              恢复
                            </button>
                          </div>
                        </React.Fragment>
                      ))}
                    </InkCard>
                  )}
                </div>
              )}

              {/* Recent Progress Feed for active domain / activity */}
              <InkSectionLabel
                title="近期进展"
                aside={`${domainLogs.length} 条`}
              />
              <InkCard variant="compact">
                {domainLogs.length === 0 ? (
                  <div style={{ padding: "12px 0" }}>
                    <InkEmpty text="底部输入框记下的每一步进展会留在这里。" />
                  </div>
                ) : (
                  <>
                    {domainLogs.slice(0, progressLimit).map((log, idx) => (
                      <React.Fragment key={log.id}>
                        {idx > 0 && <InkHairline inset={44} />}
                        <div className="mp-log-row">
                          <div className="mp-log-date">
                            <strong>
                              {Number(str(log, "day").slice(8, 10)) || 0}
                            </strong>
                            <small>
                              {Number(str(log, "day").slice(5, 7)) || 0}月
                            </small>
                          </div>
                          <div className="mp-log-main">
                            <p className="mp-log-text">{str(log, "body")}</p>
                            <span className="mp-log-place">
                              {placeLabel(log)}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="mp-circle-btn mini"
                            aria-label="进展操作"
                            onClick={() =>
                              setActionTarget({
                                title: "进展记录",
                                items: [
                                  {
                                    label: "删除这条进展",
                                    icon: "trash",
                                    danger: true,
                                    onClick: () => perform(remove(log)),
                                  },
                                ],
                              })
                            }
                          >
                            <Icon name="ellipsis" size={14} />
                          </button>
                        </div>
                      </React.Fragment>
                    ))}
                    {domainLogs.length > progressLimit && (
                      <>
                        <InkHairline />
                        <button
                          type="button"
                          className="mp-more-btn"
                          onClick={() => setProgressLimit((n) => n + 30)}
                        >
                          查看更多进展
                        </button>
                      </>
                    )}
                  </>
                )}
              </InkCard>
            </>
          )}

          {/* Tab 2: 事件 */}
          {tab === "events" && (
            <>
              <InkChipBar
                size="sm"
                value={eventStatusFilter}
                items={[
                  { value: "all", label: "全部", count: domainEvents.length },
                  {
                    value: "active",
                    label: "进行中",
                    count: domainEvents.filter((e) => e.data.status === "active")
                      .length,
                  },
                  {
                    value: "pending",
                    label: "待办",
                    count: domainEvents.filter(
                      (e) => e.data.status === "pending",
                    ).length,
                  },
                  {
                    value: "resolved",
                    label: "已完成",
                    count: domainEvents.filter(
                      (e) => e.data.status === "resolved",
                    ).length,
                  },
                ]}
                onChange={setEventStatusFilter}
              />

              <InkCard variant="compact">
                {filteredEvents.length === 0 ? (
                  <div style={{ padding: "14px 0" }}>
                    <InkEmpty text="添加一个阶段事件，例如听完 CS 61B。" />
                  </div>
                ) : (
                  filteredEvents.map((ev, idx) => {
                    const st = str(ev, "status", "active") as ProgressStatus;
                    const evAct = allActivities.find(
                      (a) => a.id === ev.data.activityId,
                    );
                    const evSessions = domainSessions.filter(
                      (s) => s.data.eventId === ev.id,
                    );
                    return (
                      <React.Fragment key={ev.id}>
                        {idx > 0 && <InkHairline />}
                        <button
                          type="button"
                          className="mp-item-row"
                          onClick={() => setDetailEventId(ev.id)}
                        >
                          <span className={`mp-status-dot ${st}`} />
                          <span className="mp-item-body">
                            <span
                              className={
                                "mp-item-title" +
                                (st === "discarded"
                                  ? " strike"
                                  : st === "resolved"
                                    ? " muted"
                                    : "")
                              }
                            >
                              {str(ev, "title")}
                            </span>
                            <span className="mp-item-meta">
                              {EVENT_STATUS_LABELS[st] ?? st}
                              {evAct ? ` · ${str(evAct, "name")}` : ""}
                            </span>
                          </span>
                          <span className="mp-item-right">
                            <EventTime sessions={evSessions} />
                            <Icon name="chevron-right" size={14} />
                          </span>
                        </button>
                      </React.Fragment>
                    );
                  })
                )}
              </InkCard>
            </>
          )}

          {/* Tab 3: 问题 */}
          {tab === "problems" && (
            <>
              {domainProblems.length === 0 ? (
                <InkCard>
                  <InkEmpty text="记下一个真正想解决的问题" />
                  <button
                    type="button"
                    className="mk-pill full"
                    onClick={() => setSheet({ kind: "problem" })}
                  >
                    + 新建问题
                  </button>
                </InkCard>
              ) : (
                PROBLEM_GROUP_ORDER.map((groupStatus) => {
                  const groupItems = domainProblems.filter(
                    (p) => str(p, "status", "active") === groupStatus,
                  );
                  if (groupItems.length === 0) return null;
                  return (
                    <React.Fragment key={groupStatus}>
                      <InkSectionLabel
                        title={PROBLEM_STATUS_LABELS[groupStatus]}
                        aside={`${groupItems.length}`}
                      />
                      <InkCard variant="compact">
                        {groupItems.map((prob, idx) => {
                          const solCount = allSolutions.filter(
                            (s) => s.data.problemId === prob.id,
                          ).length;
                          const logCount = entities.filter(
                            (e) =>
                              e.type === "progress" &&
                              e.data.problemId === prob.id,
                          ).length;
                          const probAct = allActivities.find(
                            (a) => a.id === prob.data.activityId,
                          );
                          return (
                            <React.Fragment key={prob.id}>
                              {idx > 0 && <InkHairline />}
                              <button
                                type="button"
                                className="mp-item-row"
                                onClick={() => setDetailProblemId(prob.id)}
                              >
                                <span
                                  className={`mp-status-dot ${groupStatus}`}
                                />
                                <span className="mp-item-body">
                                  <span
                                    className={
                                      "mp-item-title" +
                                      (groupStatus === "discarded"
                                        ? " strike"
                                        : groupStatus === "resolved"
                                          ? " muted"
                                          : "")
                                    }
                                  >
                                    {str(prob, "title")}
                                  </span>
                                  <span className="mp-item-meta">
                                    {probAct ? `${str(probAct, "name")} · ` : ""}
                                    {solCount} 方案 · {logCount} 进展
                                  </span>
                                </span>
                                <span className="mp-item-right">
                                  <Icon name="chevron-right" size={14} />
                                </span>
                              </button>
                            </React.Fragment>
                          );
                        })}
                      </InkCard>
                    </React.Fragment>
                  );
                })
              )}
            </>
          )}

          {/* Tab 4: 统计 */}
          {tab === "stats" && (
            <>
              <InkCard>
                <InkStatRow
                  items={[
                    { label: "今日", value: compactDuration(todaySeconds) },
                    { label: "本周", value: compactDuration(weekSeconds) },
                    { label: "本月", value: compactDuration(monthSeconds) },
                    {
                      label: "累计",
                      value: compactDuration(summary.totalSeconds),
                    },
                  ]}
                />
                <InkHairline />
                <InkBarChart
                  label="近 14 天每日投入"
                  points={chartPoints}
                  formatValue={(mins) => formatSpan(mins * 60)}
                  height={132}
                />
                {(summary.overlapSeconds > 0 || summary.unlocatedSeconds > 0) && (
                  <p className="mp-hint">
                    {summary.overlapSeconds > 0
                      ? `检测到 ${Math.round(summary.overlapSeconds / 60)} 分钟重叠，已自动去重。`
                      : ""}
                    {summary.unlocatedSeconds > 0
                      ? "旧计时缺少具体时段，按记录日期计入。"
                      : ""}
                  </p>
                )}
              </InkCard>

              {activityBreakdown.length > 0 && (
                <InkCard>
                  <div className="mp-card-head">
                    <span className="mp-card-head-title">本月子领域分布</span>
                    <span className="mp-card-head-meta">
                      {compactDuration(monthSeconds)}
                    </span>
                  </div>
                  {activityBreakdown.map(({ activity, seconds }) => (
                    <div className="mp-breakdown-item" key={activity.id}>
                      <div className="mp-breakdown-top">
                        <span>{str(activity, "name")}</span>
                        <strong>{formatSpan(seconds)}</strong>
                      </div>
                      <InkMeter
                        progress={monthSeconds > 0 ? seconds / monthSeconds : 0}
                      />
                    </div>
                  ))}
                </InkCard>
              )}

              <InkCard>
                <div className="mp-card-head">
                  <span className="mp-card-head-title">最近计时记录</span>
                  <button
                    type="button"
                    className="mk-text-btn accent"
                    onClick={() =>
                      setSheet({
                        kind: "manual",
                        defaultActivityId: selectedActivity?.id,
                      })
                    }
                  >
                    + 补录时长
                  </button>
                </div>
                {sortedRecentSessions.length === 0 ? (
                  <InkEmpty text="还没有推进记录" />
                ) : (
                  <div>
                    {sortedRecentSessions
                      .slice(0, sessionLimit)
                      .map((s, idx) => (
                        <React.Fragment key={s.id}>
                          {idx > 0 && <InkHairline />}
                          <button
                            type="button"
                            className={
                              "mp-session-row" +
                              (s.data.status === "cancelled"
                                ? " cancelled"
                                : "")
                            }
                            onClick={() =>
                              setSheet({ kind: "editSession", session: s })
                            }
                          >
                            <span className="mp-session-day">
                              {str(s, "day").slice(5)}
                            </span>
                            <span className="mk-row-main">
                              <span className="mk-row-title clamp-1">
                                {str(s, "title")}
                              </span>
                              <span className="mk-row-sub">
                                {s.data.status === "cancelled"
                                  ? "已取消"
                                  : s.data.manual
                                    ? "补录时长"
                                    : s.data.status === "running"
                                      ? "正在计时"
                                      : s.data.status === "paused"
                                        ? "已暂停"
                                        : "计时记录"}
                              </span>
                            </span>
                            <span className="mp-session-val">
                              {formatSpan(sessionSeconds(s))}
                            </span>
                          </button>
                        </React.Fragment>
                      ))}
                    {sortedRecentSessions.length > sessionLimit && (
                      <>
                        <InkHairline />
                        <button
                          type="button"
                          className="mp-more-btn"
                          onClick={() => setSessionLimit((n) => n + 20)}
                        >
                          查看更多记录
                        </button>
                      </>
                    )}
                  </div>
                )}
              </InkCard>
            </>
          )}

          {/* Pinned Bottom InkComposer on Main Practice View */}
          <InkComposer
            value={mainDraft}
            onChange={setMainDraft}
            placeholder="写一条进展…"
            onSubmit={() => perform(saveMainProgress(mainDraft))}
          />
        </>
      )}

      {renderSharedModals()}
    </InkScreen>
  );
}

/* ─────────────────────────── Bottom Sheet Forms ─────────────────────────── */

function DomainSheet({
  entity,
  nextOrder,
  onClose,
  onSaved,
  onDeleted,
}: {
  entity?: Entity;
  nextOrder: number;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [goal, setGoal] = useState(str(entity, "goal"));
  const [focused, setFocused] = useState(
    entity ? Boolean(entity.data.focused) : true,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    perform(
      put(
        "domain",
        {
          name: trimmed,
          goal: goal.trim(),
          focused,
          order: entity ? num(entity, "order", nextOrder) : nextOrder,
        },
        entity,
      ).then((id) => onSaved(id)),
    );
  };

  return (
    <InkSheet
      open
      title={entity ? "编辑领域" : "新建领域"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!name.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder="例如：AI、健身、英语"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">首页专注</span>
          <InkSwitch
            checked={focused}
            onChange={setFocused}
            label="首页专注"
          />
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">领域目标（选填）</span>
          <textarea
            className="mk-form-textarea"
            placeholder="写下这个领域长期想达成的方向…"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </div>
      </div>

      {entity && (
        <button
          type="button"
          className="mk-pill danger full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            perform(remove(entity).then(onDeleted));
          }}
        >
          {confirmDelete ? "再次点击确认删除领域" : "删除领域"}
        </button>
      )}
    </InkSheet>
  );
}

function ActivitySheet({
  domainId,
  entity,
  onClose,
  onSaved,
  onDeleted,
}: {
  domainId: string;
  entity?: Entity;
  onClose: () => void;
  onSaved: (id: string, archived: boolean) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(str(entity, "name"));
  const [archived, setArchived] = useState(Boolean(entity?.data.archived));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    perform(
      put(
        "activity",
        {
          domainId: entity ? str(entity, "domainId") : domainId,
          name: trimmed,
          archived,
        },
        entity,
      ).then((id) => onSaved(id, archived)),
    );
  };

  return (
    <InkSheet
      open
      title={entity ? "编辑子领域" : "新建子领域"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!name.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">名称</span>
          <input
            className="mk-form-input right"
            placeholder="例如：算法练习、有氧跑"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        {entity && (
          <div className="mk-form-row">
            <span className="mk-form-label">归档隐藏</span>
            <InkSwitch
              checked={archived}
              onChange={setArchived}
              label="归档隐藏"
            />
          </div>
        )}
      </div>

      {entity && (
        <button
          type="button"
          className="mk-pill danger full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            perform(remove(entity).then(onDeleted));
          }}
        >
          {confirmDelete ? "再次点击确认删除子领域" : "删除子领域"}
        </button>
      )}
    </InkSheet>
  );
}

function EventSheet({
  domainId,
  activities,
  defaultActivityId,
  entity,
  onClose,
  onSaved,
  onDeleted,
}: {
  domainId: string;
  activities: Entity[];
  defaultActivityId: string;
  entity?: Entity;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(str(entity, "title"));
  const [note, setNote] = useState(str(entity, "note"));
  const [status, setStatus] = useState<ProgressStatus>(
    (str(entity, "status", "active") as ProgressStatus) || "active",
  );
  const [actId, setActId] = useState(
    entity ? str(entity, "activityId") : defaultActivityId,
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    // Preserve locked placement fields on existing practiceEvent (EVENT_PLACEMENT_LOCKED)
    const lockedDomainId = entity ? str(entity, "domainId") : domainId;
    const lockedActId = entity ? str(entity, "activityId") : actId;
    const lockedReadingId = entity ? str(entity, "readingItemId") : "";
    perform(
      put(
        "practiceEvent",
        {
          domainId: lockedDomainId,
          ...(lockedActId ? { activityId: lockedActId } : {}),
          ...(lockedReadingId ? { readingItemId: lockedReadingId } : {}),
          title: trimmed,
          note: note.trim(),
          status,
        },
        entity,
      ).then((id) => onSaved(id)),
    );
  };

  return (
    <InkSheet
      open
      title={entity ? "编辑事件" : "新建事件"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!title.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">事件名称</span>
          <input
            className="mk-form-input right"
            placeholder="例如：听完 CS 61B"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        {!entity && activities.length > 0 && (
          <div className="mk-form-row">
            <span className="mk-form-label">子领域</span>
            <select
              className="mk-form-select"
              value={actId}
              onChange={(e) => setActId(e.target.value)}
            >
              <option value="">整个领域</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {str(a, "name")}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mk-form-row col">
          <span className="mk-form-label">状态</span>
          <div className="mk-flow-chips">
            {(["pending", "active", "resolved", "discarded"] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  className={"mk-chip sm" + (status === st ? " active" : "")}
                  onClick={() => setStatus(st)}
                >
                  {EVENT_STATUS_LABELS[st]}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">说明与目标</span>
          <textarea
            className="mk-form-textarea"
            placeholder="阶段目标、完成标准或参考资料…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {entity && (
        <button
          type="button"
          className="mk-pill danger full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            perform(remove(entity).then(onDeleted));
          }}
        >
          {confirmDelete ? "再次点击确认删除事件" : "删除事件"}
        </button>
      )}
    </InkSheet>
  );
}

function ProblemSheet({
  domainId,
  activities,
  defaultActivityId,
  entity,
  onClose,
  onSaved,
  onDeleted,
}: {
  domainId: string;
  activities: Entity[];
  defaultActivityId: string;
  entity?: Entity;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [title, setTitle] = useState(str(entity, "title"));
  const [note, setNote] = useState(str(entity, "note"));
  const [status, setStatus] = useState<ProgressStatus>(
    (str(entity, "status", "active") as ProgressStatus) || "active",
  );
  const [actId, setActId] = useState(
    entity ? str(entity, "activityId") : defaultActivityId,
  );
  const [focused, setFocused] = useState(Boolean(entity?.data.focused));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    perform(
      put(
        "problem",
        {
          domainId: entity ? str(entity, "domainId") : domainId,
          ...(actId ? { activityId: actId } : {}),
          title: trimmed,
          status,
          focused,
          note: note.trim(),
        },
        entity,
      ).then((id) => onSaved(id)),
    );
  };

  return (
    <InkSheet
      open
      title={entity ? "编辑问题" : "新建问题"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!title.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">问题</span>
          <input
            className="mk-form-input right"
            placeholder="真正想解决的问题"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        {activities.length > 0 && (
          <div className="mk-form-row">
            <span className="mk-form-label">子领域</span>
            <select
              className="mk-form-select"
              value={actId}
              onChange={(e) => setActId(e.target.value)}
            >
              <option value="">整个领域</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {str(a, "name")}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mk-form-row col">
          <span className="mk-form-label">状态</span>
          <div className="mk-flow-chips">
            {PROBLEM_GROUP_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={"mk-chip sm" + (status === st ? " active" : "")}
                onClick={() => setStatus(st)}
              >
                {PROBLEM_STATUS_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">重点关注</span>
          <InkSwitch
            checked={focused}
            onChange={setFocused}
            label="重点关注"
          />
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">问题说明与结论</span>
          <textarea
            className="mk-form-textarea"
            placeholder="背景、已知现象、当前判断或下一步…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {entity && (
        <button
          type="button"
          className="mk-pill danger full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            perform(remove(entity).then(onDeleted));
          }}
        >
          {confirmDelete ? "再次点击确认删除问题" : "删除问题"}
        </button>
      )}
    </InkSheet>
  );
}

function SolutionSheet({
  problem,
  solutions,
  entity,
  defaultParentId,
  onClose,
}: {
  problem: Entity;
  solutions: Entity[];
  entity?: Entity;
  defaultParentId?: string;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(str(entity, "title"));
  const [parentId, setParentId] = useState(
    entity ? str(entity, "parentId") : defaultParentId ?? "",
  );
  const [status, setStatus] = useState<ProgressStatus>(
    (str(entity, "status", "active") as ProgressStatus) || "active",
  );
  const [reason, setReason] = useState(str(entity, "reason"));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const forbidden = useMemo(
    () => (entity ? collectDescendantIds(solutions, entity.id) : new Set<string>()),
    [solutions, entity],
  );
  const candidates = solutions.filter((s) => !forbidden.has(s.id));

  const save = () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    perform(
      put(
        "solution",
        {
          problemId: problem.id,
          ...(parentId ? { parentId } : {}),
          title: trimmed,
          status,
          reason: reason.trim(),
        },
        entity,
      ).then(onClose),
    );
  };

  return (
    <InkSheet
      open
      title={entity ? "编辑方案" : "添加方案"}
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!title.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">方案名称</span>
          <input
            className="mk-form-input right"
            placeholder="准备尝试的做法"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">父方案</span>
          <select
            className="mk-form-select"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
          >
            <option value="">直接属于主问题</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {str(s, "title")}
              </option>
            ))}
          </select>
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">状态</span>
          <div className="mk-flow-chips">
            {(["pending", "active", "resolved", "discarded"] as const).map(
              (st) => (
                <button
                  key={st}
                  type="button"
                  className={"mk-chip sm" + (status === st ? " active" : "")}
                  onClick={() => setStatus(st)}
                >
                  {SOLUTION_STATUS_LABELS[st]}
                </button>
              ),
            )}
          </div>
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">发现 / 废弃原因</span>
          <textarea
            className="mk-form-textarea"
            placeholder="验证结果、取舍原因或后续启发…"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
      </div>

      {entity && (
        <button
          type="button"
          className="mk-pill danger full"
          onClick={() => {
            if (!confirmDelete) {
              setConfirmDelete(true);
              return;
            }
            perform(remove(entity).then(onClose));
          }}
        >
          {confirmDelete ? "再次点击确认删除方案" : "删除方案"}
        </button>
      )}
    </InkSheet>
  );
}

function ManualSessionSheet({
  domain,
  activities,
  defaultActivityId,
  event,
  problem,
  solution,
  onClose,
}: {
  domain: Entity;
  activities: Entity[];
  defaultActivityId?: string;
  event?: Entity;
  problem?: Entity;
  solution?: Entity;
  onClose: () => void;
}) {
  const lockedActId = event
    ? str(event, "activityId")
    : problem
      ? str(problem, "activityId")
      : undefined;
  const [actId, setActId] = useState(lockedActId ?? defaultActivityId ?? "");
  const initialTitle = (
    event
      ? str(event, "title")
      : solution
        ? str(solution, "title")
        : problem
          ? str(problem, "title")
          : str(
              activities.find((a) => a.id === (lockedActId ?? defaultActivityId)),
              "name",
              str(domain, "name"),
            )
  ).slice(0, 500);
  const [title, setTitle] = useState(initialTitle);
  const [day, setDay] = useState(today());
  const [minutes, setMinutes] = useState("30");
  const [note, setNote] = useState("");

  const parsedMinutes = Number(minutes);
  const valid =
    title.trim().length > 0 &&
    Number.isFinite(parsedMinutes) &&
    parsedMinutes > 0 &&
    parsedMinutes <= 1440;

  const save = () => {
    if (!valid) return;
    const finalActId = event ? str(event, "activityId") : actId;
    perform(
      put("session", {
        domainId: domain.id,
        ...(finalActId ? { activityId: finalActId } : {}),
        ...(event ? { eventId: event.id } : {}),
        ...(!event && problem ? { problemId: problem.id } : {}),
        ...(!event && problem && solution ? { solutionId: solution.id } : {}),
        title: title.trim().slice(0, 500),
        day,
        elapsedSeconds: Math.round(parsedMinutes * 60),
        status: "finished",
        manual: true,
        segments: [],
        ...(note.trim() ? { note: note.trim() } : {}),
      }).then(onClose),
    );
  };

  return (
    <InkSheet
      open
      title="补录时长"
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!valid}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">内容</span>
          <input
            className="mk-form-input right"
            placeholder="本次推进内容"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        {!event && !problem && activities.length > 0 && (
          <div className="mk-form-row">
            <span className="mk-form-label">子领域</span>
            <select
              className="mk-form-select"
              value={actId}
              onChange={(e) => setActId(e.target.value)}
            >
              <option value="">整个领域</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {str(a, "name")}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="mk-form-row">
          <span className="mk-form-label">日期</span>
          <input
            type="date"
            className="mk-form-input right"
            max={today()}
            value={day}
            onChange={(e) => setDay(e.target.value || today())}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">时长（分钟）</span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="1440"
            step="1"
            className="mk-form-input right"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
          />
        </div>
      </div>

      <div className="mp-preset-row">
        {MANUAL_PRESETS.map((p) => (
          <button
            key={p.minutes}
            type="button"
            className={
              "mk-chip sm" + (Number(minutes) === p.minutes ? " active" : "")
            }
            onClick={() => setMinutes(String(p.minutes))}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mk-form-group">
        <div className="mk-form-row col">
          <span className="mk-form-label">备注（选填）</span>
          <textarea
            className="mk-form-textarea"
            placeholder="补充记录…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </InkSheet>
  );
}

function EditSessionSheet({
  session,
  onClose,
}: {
  session: Entity;
  onClose: () => void;
}) {
  const isManual = Boolean(session.data.manual);
  const isActive = ["running", "paused"].includes(str(session, "status"));
  const [title, setTitle] = useState(str(session, "title"));
  const [day, setDay] = useState(str(session, "day", today()));
  const [minutes, setMinutes] = useState(
    String(Math.max(1, Math.round(sessionSeconds(session) / 60))),
  );
  const [note, setNote] = useState(str(session, "note"));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const parsedMinutes = Number(minutes);
  const valid =
    title.trim().length > 0 &&
    (!isManual ||
      (Number.isFinite(parsedMinutes) &&
        parsedMinutes > 0 &&
        parsedMinutes <= 1440));

  const save = () => {
    if (!valid) return;
    const nextData = {
      ...session.data,
      title: title.trim().slice(0, 500),
      day,
      note: note.trim(),
      ...(isManual ? { elapsedSeconds: Math.round(parsedMinutes * 60) } : {}),
    };
    perform(put("session", nextData, session).then(onClose));
  };

  return (
    <InkSheet
      open
      title="计时记录详情"
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!valid}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">标题</span>
          <input
            className="mk-form-input right"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">日期</span>
          <input
            type="date"
            className="mk-form-input right"
            value={day}
            onChange={(e) => setDay(e.target.value || str(session, "day"))}
          />
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">时长</span>
          {isManual ? (
            <input
              type="number"
              inputMode="decimal"
              min="1"
              max="1440"
              className="mk-form-input right"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          ) : (
            <span className="mp-session-val">
              {formatSpan(sessionSeconds(session))}
            </span>
          )}
        </div>
        <div className="mk-form-row col">
          <span className="mk-form-label">备注</span>
          <textarea
            className="mk-form-textarea"
            placeholder="补充记录…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>

      {session.data.status !== "cancelled" && (
        <button
          type="button"
          className="mk-pill full"
          onClick={() =>
            perform(controlSession(session, "cancel").then(onClose))
          }
        >
          {isActive ? "取消本次计时" : "作废此条计时（不计入统计）"}
        </button>
      )}

      <button
        type="button"
        className="mk-pill danger full"
        onClick={() => {
          if (!confirmDelete) {
            setConfirmDelete(true);
            return;
          }
          perform(remove(session).then(onClose));
        }}
      >
        {confirmDelete ? "再次点击确认永久删除" : "删除记录"}
      </button>
    </InkSheet>
  );
}

function QuickProgressSheet({
  domain,
  activity,
  onClose,
}: {
  domain: Entity;
  activity?: Entity;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [day, setDay] = useState(today());

  const save = () => {
    if (!body.trim()) return;
    perform(
      put("progress", {
        domainId: domain.id,
        ...(activity ? { activityId: activity.id } : {}),
        day,
        body: body.trim(),
      }).then(onClose),
    );
  };

  return (
    <InkSheet
      open
      title="记一条进展"
      onClose={onClose}
      rightLabel="保存"
      rightDisabled={!body.trim()}
      onRight={save}
    >
      <div className="mk-form-group">
        <div className="mk-form-row">
          <span className="mk-form-label">归属</span>
          <span className="mp-card-head-meta">
            {str(domain, "name")}
            {activity ? ` / ${str(activity, "name")}` : ""}
          </span>
        </div>
        <div className="mk-form-row">
          <span className="mk-form-label">日期</span>
          <input
            type="date"
            className="mk-form-input right"
            value={day}
            onChange={(e) => setDay(e.target.value || today())}
          />
        </div>
        <div className="mk-form-row col">
          <textarea
            className="mk-form-textarea"
            placeholder="记下这一步的进展、发现或卡点…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            autoFocus
          />
        </div>
      </div>
    </InkSheet>
  );
}
