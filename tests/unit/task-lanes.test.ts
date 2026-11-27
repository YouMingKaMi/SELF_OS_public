import assert from "node:assert/strict";
import { test } from "node:test";
import { taskLanes } from "../../apps/web/src/features/task-lanes.ts";

test("cross-rank edges bypass intermediate nodes without changing unobstructed paths", () => {
  const ranks = [[-14, 100], [27, 0], [], [80, 128], [200]];
  const size = 20;
  const laneAt = taskLanes(ranks, size);
  for (let from = 0; from < ranks.length; from++) {
    for (let to = from + 1; to < ranks.length; to++) {
      const intervening = ranks.slice(from + 1, to).flat();
      for (let lane = -20; lane <= 210; lane++) {
        const blocked = intervening.some((start) => lane >= start - 7 && lane <= start + size + 7);
        assert.equal(laneAt(from, to, lane),
          blocked ? Math.max(...intervening) + size + 8 : lane);
      }
    }
  }
});
