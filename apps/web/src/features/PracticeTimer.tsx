import React, { useState, useEffect } from "react";
import {
  useEntities,
  put,
  type AnyEntity as Entity,
} from "../data/entities.ts";
import { str, num, arr, perform } from "../ui/shared.tsx";
export const duration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return (
    String(Math.floor(s / 3600)).padStart(2, "0") +
    ":" +
    String(Math.floor(s / 60) % 60).padStart(2, "0") +
    ":" +
    String(s % 60).padStart(2, "0")
  );
};
export function sessionSeconds(e: Entity, now = Date.now()) {
  return e.data.status === "cancelled"
    ? 0
    : num(e, "elapsedSeconds") +
        (e.data.status === "running" && e.data.runningSince
          ? Math.max(0, (now - Date.parse(str(e, "runningSince"))) / 1000)
          : 0);
}
export async function controlSession(
  e: Entity,
  action: "pause" | "resume" | "finish" | "cancel",
) {
  const data = { ...e.data };
  const now = new Date().toISOString();
  if (e.data.status === "running" && e.data.runningSince) {
    data.elapsedSeconds = sessionSeconds(e);
    data.segments = [...arr(e, "segments"), str(e, "runningSince") + "/" + now];
  }
  delete data.runningSince;
  data.status =
    action === "pause"
      ? "paused"
      : action === "resume"
        ? "running"
        : action === "cancel"
          ? "cancelled"
          : "finished";
  if (action === "resume") data.runningSince = now;
  if (action === "finish" || action === "cancel") data.endedAt = now;
  await put("session", data, e);
}
export function Timer({ session }: { session: Entity }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <span className="timer-digits">
      {duration(sessionSeconds(session, now))}
    </span>
  );
}
export function FloatingTimer() {
  const { entities } = useEntities("session");
  const current = entities.find((e) =>
    ["running", "paused"].includes(str(e, "status")),
  );
  if (!current) return null;
  return (
    <div className="floating-timer">
      <strong>{str(current, "title")}</strong>
      <Timer session={current} />
      <button
        onClick={() =>
          perform(
            controlSession(
              current,
              current.data.status === "running" ? "pause" : "resume",
            ),
          )
        }
      >
        {current.data.status === "running" ? "暂停" : "继续"}
      </button>
      <button onClick={() => perform(controlSession(current, "finish"))}>
        结束
      </button>
      <button
        aria-label="取消本次计时"
        onClick={() => perform(controlSession(current, "cancel"))}
      >
        ×
      </button>
    </div>
  );
}
