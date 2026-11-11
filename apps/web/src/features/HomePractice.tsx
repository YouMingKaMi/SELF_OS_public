import React, { useState } from "react";
import { put, type AnyEntity as Entity } from "../data/entities.ts";
import { perform, str, today, usePreference } from "../ui/shared.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Timer, controlSession } from "./PracticeTimer.tsx";
import type { Navigate } from "../navigation.ts";

export function HomePractice({
  entities,
  navigate,
}: {
  entities: Entity[];
  navigate: Navigate;
}) {
  const domains = entities.filter((e) => e.type === "domain");
  const [domainId, setDomain] = usePreference("practice-domain", "");
  const domain =
    domains.find((e) => e.id === domainId) ??
    domains.find((e) => e.data.focused) ??
    domains[0];
  const [activityId, setActivity] = useState("");
  const [problemId, setProblem] = useState("");
  const [solutionId, setSolution] = useState("");
  const [saving, setSaving] = useState(false);
  const activities = entities.filter(
    (e) =>
      e.type === "activity" &&
      e.data.domainId === domain?.id &&
      !e.data.archived,
  );
  const problems = entities.filter(
    (e) =>
      e.type === "problem" &&
      e.data.domainId === domain?.id &&
      (!activityId || e.data.activityId === activityId) &&
      e.data.status !== "discarded" &&
      e.data.status !== "resolved",
  );
  const solutions = entities.filter(
    (e) =>
      e.type === "solution" &&
      e.data.problemId === problemId &&
      e.data.status !== "discarded" &&
      e.data.status !== "resolved",
  );
  const running = entities.find(
    (e) =>
      e.type === "session" && ["running", "paused"].includes(str(e, "status")),
  );
  function solutionPath(entity: Entity): string {
    const names = [str(entity, "title")];
    const seen = new Set([entity.id]);
    let parent = solutions.find((e) => e.id === entity.data.parentId);
    while (parent && !seen.has(parent.id)) {
      seen.add(parent.id);
      names.unshift(str(parent, "title"));
      parent = solutions.find((e) => e.id === parent!.data.parentId);
    }
    return names.join(" / ");
  }
  async function start() {
    if (!domain || running || saving) return;
    setSaving(true);
    const selected = entities.find(
      (e) => e.id === (solutionId || problemId || activityId),
    );
    const timestamp = new Date().toISOString();
    try {
      await put("session", {
        domainId: domain.id,
        ...(activityId ? { activityId } : {}),
        ...(problemId ? { problemId } : {}),
        ...(solutionId ? { solutionId } : {}),
        title: selected
          ? str(selected, "title", str(selected, "name"))
          : str(domain, "name"),
        day: today(),
        startedAt: timestamp,
        runningSince: timestamp,
        elapsedSeconds: 0,
        segments: [],
        status: "running",
        manual: false,
      });
    } finally {
      setSaving(false);
    }
  }
  return running ? (
    <div className="home-session">
      <div className="session-label">
        <span className="status-dot" />
        {running.data.status === "running" ? "正在推进" : "已暂停"}
        <span>
          {str(
            entities.find((e) => e.id === running.data.domainId),
            "name",
          )}
        </span>
      </div>
      <h3>{str(running, "title")}</h3>
      <Timer session={running} />
      <div className="form-actions">
        <button
          className="primary"
          onClick={() =>
            perform(
              controlSession(
                running,
                running.data.status === "running" ? "pause" : "resume",
              ),
            )
          }
        >
          {running.data.status === "running" ? "暂停" : "继续"}
        </button>
        <button onClick={() => perform(controlSession(running, "finish"))}>
          结束
        </button>
        <button onClick={() => perform(controlSession(running, "cancel"))}>
          取消误触
        </button>
        <button className="muted" onClick={() => navigate("practice")}>
          记录进展
        </button>
      </div>
    </div>
  ) : (
    <div className="home-practice">
      <p className="home-intro">选定方向，从这一刻开始。</p>
      {domains.length ? (
        <>
          <div className="quick-start-fields">
            <label>
              领域
              <select
                aria-label="快速推进领域"
                value={domain?.id ?? ""}
                onChange={(e) => {
                  setDomain(e.target.value);
                  setActivity("");
                  setProblem("");
                  setSolution("");
                }}
              >
                {domains.map((e) => (
                  <option key={e.id} value={e.id}>
                    {str(e, "name")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              子领域
              <select
                aria-label="快速推进子领域"
                value={activityId}
                onChange={(e) => {
                  setActivity(e.target.value);
                  setProblem("");
                  setSolution("");
                }}
              >
                <option value="">直接推进领域</option>
                {activities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {str(e, "name")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              问题 · 可选
              <select
                aria-label="快速推进问题"
                value={problemId}
                onChange={(e) => {
                  setProblem(e.target.value);
                  setSolution("");
                }}
              >
                <option value="">不关联问题</option>
                {problems.map((e) => (
                  <option key={e.id} value={e.id}>
                    {str(e, "title")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              方案 · 可选
              <select
                aria-label="快速推进方案"
                value={solutionId}
                disabled={!problemId}
                onChange={(e) => setSolution(e.target.value)}
              >
                <option value="">不关联方案</option>
                {solutions.map((e) => (
                  <option key={e.id} value={e.id}>
                    {solutionPath(e)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button
              className="primary"
              disabled={saving}
              onClick={() => perform(start())}
            >
              <Icon name="practice" size={16} />
              {saving ? "正在开始…" : "开始推进"}
            </button>
            <button className="muted" onClick={() => navigate("practice")}>
              完整推进台
            </button>
          </div>
        </>
      ) : (
        <div className="home-empty">
          <p>先添加一个领域，把想推进的事放在这里。</p>
          <button className="primary" onClick={() => navigate("practice")}>
            添加领域
          </button>
        </div>
      )}
    </div>
  );
}
