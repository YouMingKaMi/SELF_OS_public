import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Task } from "../data/tasks.ts";
import { taskLanes } from "./task-lanes.ts";

type Edge = { from: string; to: string };

function edgesOf(tasks: Task[]): Edge[] {
  const ids = new Set(tasks.map((task) => task.id));
  return tasks.flatMap((task) =>
    task.prerequisiteIds
      .filter((id) => ids.has(id))
      .map((from) => ({ from, to: task.id })),
  );
}

export function taskLayers(tasks: Task[]): Task[][] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const rank = new Map<string, number>();
  const waiting = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const { from, to } of edgesOf(tasks)) {
    waiting.set(to, (waiting.get(to) ?? 0) + 1);
    const children = outgoing.get(from) ?? [];
    children.push(to);
    outgoing.set(from, children);
  }
  const queue = tasks
    .filter((task) => !waiting.has(task.id))
    .map((task) => task.id);
  const layers: Task[][] = [];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!;
    const level = rank.get(id) ?? 0;
    (layers[level] ??= []).push(byId.get(id)!);
    for (const to of outgoing.get(id) ?? []) {
      rank.set(to, Math.max(rank.get(to) ?? 0, level + 1));
      const count = waiting.get(to)! - 1;
      waiting.set(to, count);
      if (!count) queue.push(to);
    }
  }
  if (queue.length < tasks.length) {
    const placed = new Set(queue);
    (layers[0] ??= []).push(...tasks.filter((task) => !placed.has(task.id)));
  }
  return layers;
}

type Props = {
  tasks: Task[];
  tone: (task: Task) => string;
  metadata: (task: Task) => ReactNode;
  open: (task: Task) => void;
  selected?: string;
  highlighted?: ReadonlySet<string>;
  linking: boolean;
  source?: string;
  canLink: (task: Task) => boolean;
  onUnlink: (from: string, to: string) => void;
};

export function TaskGraph({
  tasks,
  tone,
  metadata,
  open,
  selected,
  highlighted,
  linking,
  source,
  canLink,
  onUnlink,
}: Props) {
  const baseId = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const [zoom, setZoom] = useState(1);
  const [hover, setHover] = useState<string>();
  const panning = useRef<{ x: number; y: number; left: number; top: number }>(
    null,
  );
  const [dragging, setDragging] = useState(false);
  const layers = useMemo(() => taskLayers(tasks), [tasks]);
  const edges = useMemo(() => edgesOf(tasks), [tasks]);
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry!.contentRect.width),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const narrow = width < 570;
  const desktopWidth = Math.min(
    188,
    Math.max(
      154,
      (width - 56 - (layers.length - 1) * 55) / Math.max(1, layers.length),
    ),
  );
  const nodeWidth = narrow
    ? Math.max(108, Math.min(160, Math.floor((width - 56) / 2)))
    : desktopWidth;
  const nodeHeight = 64;
  const widest = layers.reduce((largest, layer) => Math.max(largest, layer.length), 1);
  const stepX = nodeWidth + (narrow ? 22 : 55);
  const stepY = narrow ? 116 : 100;
  const inset = narrow ? 16 : 30;
  const canvasWidth = Math.max(
    width / zoom,
    inset * 2 + (narrow ? widest : layers.length) * stepX - (stepX - nodeWidth),
  );
  const canvasHeight = Math.max(
    narrow ? 330 : 400,
    inset * 2 +
      (narrow ? layers.length : widest) * stepY -
      (stepY - nodeHeight),
  );
  const { position, outerLane } = useMemo(() => {
  const position = new Map<string, { x: number; y: number; rank: number }>();
  const byRank: number[][] = [];
  layers.forEach((layer, i) => {
    const center = (widest - layer.length) / 2;
    layer.forEach((task, j) => {
      const parents = task.prerequisiteIds
        .map((id) => position.get(id))
        .filter((p) => p !== undefined);
      const row =
        (canvasWidth - (widest - 1) * stepX - nodeWidth) / 2 +
        (j + center) * stepX;
      const column = inset + (j + center) * stepY;
      const preferred = narrow ? row : column;
      const across =
        layer.length === 1 && parents.length
          ? parents.reduce(
              (total, parent) => total + (narrow ? parent.x : parent.y),
              0,
            ) / parents.length
          : preferred;
      position.set(
        task.id,
        narrow
          ? { x: across, y: inset + i * stepY, rank: i }
          : { x: inset + i * stepX, y: across, rank: i },
      );
      (byRank[i] ??= []).push(across);
    });
  });
  return { position, outerLane: taskLanes(byRank, narrow ? nodeWidth : nodeHeight) };
  }, [layers, widest, narrow, canvasWidth, stepX, stepY, inset, nodeWidth]);
  const focused = hover ?? selected;
  const offsets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const { to } of edges) counts.set(to, (counts.get(to) ?? 0) + 1);
    const seen = new Map<string, number>();
    return edges.map(({ to }) => {
      const ordinal = seen.get(to) ?? 0;
      seen.set(to, ordinal + 1);
      return (ordinal - (counts.get(to)! - 1) / 2) * 8;
    });
  }, [edges]);
  return (
    <div className="task-graph">
      <div
        ref={viewport}
        className={"task-graph-viewport" + (dragging ? " panning" : "")}
        aria-label="任务关系图"
        role="region"
        tabIndex={0}
        onPointerDown={(event) => {
          if (
            event.pointerType !== "mouse" ||
            event.button !== 0 ||
            (event.target as Element).closest("button, [data-edge]")
          )
            return;
          const element = event.currentTarget;
          panning.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          element.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!panning.current) return;
          const { x, y, left, top } = panning.current;
          event.currentTarget.scrollLeft = left + x - event.clientX;
          event.currentTarget.scrollTop = top + y - event.clientY;
        }}
        onLostPointerCapture={() => {
          panning.current = null;
          setDragging(false);
        }}
      >
        <div
          className="task-graph-space"
          style={{ width: canvasWidth * zoom, height: canvasHeight * zoom }}
        >
          <div
            className="task-graph-board"
            style={{
              width: canvasWidth,
              height: canvasHeight,
              transform: `scale(${zoom})`,
            }}
          >
            <svg
              className="task-graph-edges"
              aria-hidden="true"
              width={canvasWidth}
              height={canvasHeight}
            >
              <defs>
                <marker
                  id={baseId}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M1 1l5 3-5 3" className="task-graph-arrow" />
                </marker>
                <marker
                  id={baseId + "-active"}
                  viewBox="0 0 8 8"
                  refX="7"
                  refY="4"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M1 1l5 3-5 3" className="task-graph-arrow active" />
                </marker>
              </defs>
              {edges.map((edge, index) => {
                const { from, to } = edge;
                const a = position.get(from)!;
                const b = position.get(to)!;
                const start = narrow ? a.y + nodeHeight : a.x + nodeWidth;
                const end = (narrow ? b.y : b.x) - 3;
                const fromLane = narrow
                  ? a.x + nodeWidth / 2
                  : a.y + nodeHeight / 2;
                const toLane =
                  (narrow ? b.x + nodeWidth / 2 : b.y + nodeHeight / 2) +
                  offsets[index];
                const xy = (along: number, across: number) =>
                  narrow ? `${across} ${along}` : `${along} ${across}`;
                const lane = outerLane(a.rank, b.rank, fromLane);
                const turn = Math.min(24, (end - start) / 2);
                const d =
                  b.rank > a.rank + 1
                    ? `M${xy(start, fromLane)} C${xy(start + turn, fromLane)} ${xy(start + turn, lane)} ${xy(start + turn * 1.15, lane)} L${xy(end - turn * 1.15, lane)} C${xy(end - turn, lane)} ${xy(end - turn, toLane)} ${xy(end, toLane)}`
                    : `M${xy(start, fromLane)} C${xy((start + end) / 2, fromLane)} ${xy((start + end) / 2, toLane)} ${xy(end, toLane)}`;
                const active = from === focused || to === focused;
                return (
                  <g key={from + to}>
                    <path
                      d={d}
                      className={"task-graph-edge" + (active ? " active" : "")}
                      markerEnd={`url(#${baseId}${active ? "-active" : ""})`}
                    />
                    {source === from && linking && (
                      <path
                        d={d}
                        data-edge=""
                        className="task-graph-edge-hit"
                        onClick={() => onUnlink(from, to)}
                      >
                        <title>移除此依赖</title>
                      </path>
                    )}
                  </g>
                );
              })}
            </svg>
            {tasks.map((task) => {
              const point = position.get(task.id)!;
              return (
                <button
                  key={task.id}
                  type="button"
                  className={`task-node ${tone(task)}${source === task.id || selected === task.id ? " selected" : ""}${highlighted?.has(task.id) ? " just-unlocked" : ""}`}
                  style={{
                    left: point.x,
                    top: point.y,
                    width: nodeWidth,
                    height: nodeHeight,
                  }}
                  aria-label={task.title}
                  aria-pressed={source === task.id || selected === task.id}
                  disabled={linking && !canLink(task)}
                  onPointerEnter={() => setHover(task.id)}
                  onPointerLeave={() => setHover(undefined)}
                  onFocus={() => setHover(task.id)}
                  onBlur={() => setHover(undefined)}
                  onClick={() => open(task)}
                >
                  <strong>{task.title}</strong>
                  <small>{metadata(task)}</small>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {!!tasks.length && (
        <div className="task-graph-zoom">
          <button
            aria-label="缩小关系图"
            disabled={zoom <= 0.65}
            onClick={() => setZoom((value) => Math.max(0.65, value - 0.15))}
          >
            −
          </button>
          <button aria-label="还原关系图大小" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button
            aria-label="放大关系图"
            disabled={zoom >= 1.6}
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.15))}
          >
            ＋
          </button>
        </div>
      )}
    </div>
  );
}

export function TaskTrack({
  tasks,
  tone,
  children,
}: {
  tasks: Task[];
  tone: (task: Task) => string;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [centers, setCenters] = useState<Record<string, number>>({});
  const edges = useMemo(() => edgesOf(tasks), [tasks]);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element || edges.length === 0) return;
    const measure = () => {
      const top = element.getBoundingClientRect().top;
      setCenters(
        Object.fromEntries(
          Array.from(
            element.querySelectorAll<HTMLElement>("[data-track-id]"),
            (node) => {
              const rect = node.getBoundingClientRect();
              return [node.dataset.trackId!, rect.top - top + rect.height / 2];
            },
          ),
        ),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element
      .querySelectorAll(".task-row")
      .forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [tasks, edges]);
  const statuses = new Map(tasks.map((task) => [task.id, tone(task)]));
  return (
    <div className="task-track" ref={container}>
      {edges.length > 0 && (
        <svg
          aria-hidden="true"
          className="task-track-lines"
          width="48"
          height="100%"
        >
          {edges.map(({ from, to }, index) => {
            const a = centers[from],
              b = centers[to];
            if (a === undefined || b === undefined) return null;
            const radius = Math.min(7, Math.abs(b - a) / 4);
            const direction = b >= a ? 1 : -1;
            const lane = 5 + (index % 3) * 4;
            return (
              <path
                key={from + to}
                className={statuses.get(from)}
                d={`M24 ${a} H${lane + radius} Q${lane} ${a} ${lane} ${a + direction * radius} V${b - direction * radius} Q${lane} ${b} ${lane + radius} ${b} H24`}
              />
            );
          })}
        </svg>
      )}
      {children}
    </div>
  );
}
