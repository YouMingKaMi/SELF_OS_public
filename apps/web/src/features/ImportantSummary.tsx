import React from "react";
import { put, type AnyEntity as Entity } from "../data/entities.ts";
import { str, num, today, perform } from "../ui/shared.tsx";
import { nextOccurrence } from "./calendar-model.ts";
import type { Navigate } from "../navigation.ts";
export default function ImportantSummary({
  entities,
  navigate,
}: {
  entities: Entity[];
  navigate: Navigate;
}) {
  return (
    <div className="dense-list">
      {entities
        .filter((e) => e.type === "importantDay")
        .map((e) => {
          const next = nextOccurrence(e);
          const delta = next
            ? Math.round((Date.parse(next) - Date.parse(today())) / 86400000)
            : null;
          return delta !== null &&
            delta >= 0 &&
            delta <= num(e, "remindDays", 3) &&
            (delta === 0 || e.data.dismissedDate !== next) ? (
            <div key={e.id}>
              <button onClick={() => navigate("days")}>
                <strong>
                  {str(e, "name")} · {delta === 0 ? "今天" : delta + "天后"}
                </strong>
                <small>{next}</small>
              </button>
              {delta > 0 && (
                <button
                  onClick={() =>
                    perform(
                      put(
                        "importantDay",
                        { ...e.data, dismissedDate: next! },
                        e,
                      ),
                    )
                  }
                >
                  ×
                </button>
              )}
            </div>
          ) : null;
        })}
      <button onClick={() => navigate("days")}>查看所有重要日子 ↗</button>
    </div>
  );
}
