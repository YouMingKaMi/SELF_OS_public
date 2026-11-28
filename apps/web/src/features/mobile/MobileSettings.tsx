import React, { useEffect, useMemo, useRef, useState } from "react";
import { stringifyAliasMap } from "../../../../../modules/workspace/index.ts";
import {
  importWorkspaceBackup,
  isLocalMode,
  parseWorkspaceImport,
  put,
  saveEdit,
  settle,
  synchronize,
  undoPending,
  useEverything,
  usePending,
  useSyncStatus,
  type AnyEntity as Entity,
  type Data,
  type ImportStrategy,
  type ParsedWorkspaceBackup,
  type Pending,
  type WorkspaceSyncState,
} from "../../data/entities.ts";
import {
  readWorkspaceOverview,
  subscribeWorkspaceOverview,
  writeWorkspaceExport,
  type WorkspaceOverview,
} from "../../data/export.ts";
import { feature } from "../../navigation.ts";
import {
  isAndroidApp,
  openAndroidEndpointSettings,
} from "../../ui/android-bridge.ts";
import { downloadFile } from "../../ui/download.ts";
import { Icon } from "../../ui/Icon.tsx";
import { perform, str, today } from "../../ui/shared.tsx";
import {
  BUILTIN_DEPARTMENTS,
  PRESET_LIST,
  TOGGLEABLE_FEATURES,
  WORKSPACE_CONFIG_ID,
  useWorkspaceConfig,
} from "../workspace-config.ts";
import {
  InkActionSheet,
  InkCard,
  InkChipBar,
  InkEmpty,
  InkHairline,
  InkNavText,
  InkScreen,
  InkSearch,
  InkSectionLabel,
  InkSegmented,
  InkSheet,
  InkSwitch,
  MobileSubPage,
} from "./MobileKit.tsx";
import "./mobile-screens.css";

type SubPage = null | "workspace" | "aliases" | "conflicts" | "trash";

const KIND_LABELS: Record<string, string> = {
  department: "部门",
  workspaceConfig: "工作区配置",
  domain: "领域",
  activity: "子领域",
  problem: "问题",
  solution: "方案",
  practiceEvent: "推进事件",
  session: "计时记录",
  progress: "进展",
  taskList: "任务清单",
  task: "任务",
  checklist: "准备清单",
  checklistRun: "清单勾选",
  achievement: "成就",
  habit: "习惯",
  habitRule: "习惯规则",
  habitLog: "习惯打卡",
  budget: "月度预算",
  category: "消费分类",
  expense: "消费",
  recurringExpense: "固定支出",
  wallet: "国库账户",
  asset: "资产",
  assetPrice: "资产行情",
  walletEntry: "国库记录",
  document: "文章",
  journal: "每日记录",
  idea: "想法",
  memoir: "回忆录",
  readingItem: "收藏",
  metric: "指标",
  metricLog: "指标记录",
  importantDay: "重要日子",
  storageBox: "储物箱",
  storageItem: "储物物品",
};

const PRESET_TITLES: Record<string, string> = {
  council: "个人内阁",
  standard: "常规生活",
  minimal: "极简起步",
  custom: "自定义",
};

function syncPresentation(state: WorkspaceSyncState, message: string): {
  label: string;
  tone: "live" | "warn" | "danger";
} {
  switch (state) {
    case "local":
      return { label: "仅本机模式", tone: "live" };
    case "synced":
      return { label: "已同步", tone: "live" };
    case "connecting":
      return { label: "同步中", tone: "warn" };
    case "offline":
      return { label: "离线", tone: "warn" };
    case "attention":
      return { label: "有冲突待处理", tone: "warn" };
    case "unauthorized":
    case "unreachable":
    case "upgrade":
      return { label: message, tone: "danger" };
  }
}

function entityTitle(e: Entity): string {
  const title = str(e, "title").trim();
  if (title) return title;
  const name = str(e, "name").trim();
  if (name) return name;
  const body = str(e, "body").trim();
  if (body) return body.slice(0, 60);
  const day = str(e, "day").trim();
  if (day) return `${KIND_LABELS[e.type] ?? e.type} · ${day}`;
  return e.id;
}

function pendingTitle(op: Pending): string {
  const raw =
    op.data?.title ??
    op.data?.name ??
    op.data?.body ??
    op.recoveryDraft?.data.title ??
    op.recoveryDraft?.data.name ??
    op.recoveryDraft?.data.body ??
    op.server?.data.title ??
    op.server?.data.name ??
    op.server?.data.body;
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 80);
  return KIND_LABELS[op.entityType] ?? op.entityType;
}

export function MobileSettings({
  theme,
  setTheme,
}: {
  theme: string;
  setTheme: (t: string) => void;
}) {
  const ws = useWorkspaceConfig();
  const pending = usePending();
  const syncStatus = useSyncStatus(true);
  const localMode = isLocalMode() || syncStatus.state === "local";

  const [subPage, setSubPage] = useState<SubPage>(null);
  const [syncingNow, setSyncingNow] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState("");
  const [importNote, setImportNote] = useState("");
  const [importError, setImportError] = useState("");
  const [importCandidate, setImportCandidate] =
    useState<ParsedWorkspaceBackup | null>(null);
  const [importStrategy, setImportStrategy] =
    useState<ImportStrategy>("merge");
  const [importingNow, setImportingNow] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [overview, setOverview] = useState<WorkspaceOverview>({
    live: 0,
    deleted: 0,
    trash: [],
  });

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
          const result = await readWorkspaceOverview(false);
          if (active) setOverview(result);
        }
      } finally {
        loading = false;
      }
    }
    const unsubscribe = subscribeWorkspaceOverview(refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const conflicts = useMemo(
    () => pending.filter((p) => p.state === "conflict" || p.state === "error"),
    [pending],
  );
  const queued = useMemo(
    () => pending.filter((p) => p.state === "queued" || p.state === "sending"),
    [pending],
  );

  const enabledCount = TOGGLEABLE_FEATURES.filter((k) => ws.isEnabled(k)).length;
  const normalizedTheme: "dark" | "light" | "system" =
    theme === "dark" || theme === "light" || theme === "system"
      ? theme
      : "system";

  const android = isAndroidApp();
  const syncInfo = syncPresentation(syncStatus.state, syncStatus.message);

  async function handleSyncTap() {
    if (syncingNow) return;
    setSyncingNow(true);
    try {
      await synchronize();
    } finally {
      setTimeout(() => setSyncingNow(false), 350);
    }
  }

  async function handleExport() {
    if (exporting) return;
    setExporting(true);
    setExportNote("");
    try {
      await downloadFile(
        `SELF-OS-${today()}.json`,
        "application/json",
        writeWorkspaceExport,
      );
      setExportNote("已导出 JSON 备份");
    } catch (error) {
      setExportNote(
        error instanceof Error ? error.message : "导出失败，请稍后重试",
      );
    } finally {
      setExporting(false);
    }
  }

  async function handlePickImportFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    setImportNote("");
    try {
      const text = await file.text();
      const parsed = parseWorkspaceImport(text);
      setImportCandidate(parsed);
      setImportStrategy("merge");
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "无法读取该备份文件",
      );
    }
  }

  async function executeImport() {
    if (!importCandidate || importingNow) return;
    setImportingNow(true);
    setImportError("");
    try {
      const strategy: ImportStrategy = localMode ? importStrategy : "merge";
      const res = await importWorkspaceBackup(importCandidate, strategy);
      setImportCandidate(null);
      setImportNote(
        res.mode === "local"
          ? `恢复完成：新增 ${res.imported} 条，更新 ${res.updated} 条${res.skipped > 0 ? `，跳过 ${res.skipped} 条` : ""}`
          : `已加入同步队列：新增 ${res.imported} 条，更新 ${res.updated} 条${res.skipped > 0 ? `，跳过 ${res.skipped} 条` : ""}`,
      );
    } catch (error) {
      setImportError(
        error instanceof Error ? error.message : "导入失败，请稍后重试",
      );
    } finally {
      setImportingNow(false);
    }
  }

  if (subPage === "workspace") {
    return (
      <WorkspaceSubPage
        ws={ws}
        onBack={() => setSubPage(null)}
        onOpenAliases={() => setSubPage("aliases")}
      />
    );
  }

  if (subPage === "aliases") {
    return (
      <WorkspaceAliasesSubPage
        ws={ws}
        onBack={() => setSubPage("workspace")}
      />
    );
  }

  if (subPage === "conflicts") {
    return (
      <ConflictsSubPage
        pending={pending}
        conflicts={conflicts}
        queued={queued}
        onBack={() => setSubPage(null)}
      />
    );
  }

  if (subPage === "trash") {
    return <RecycleBinSubPage onBack={() => setSubPage(null)} />;
  }

  return (
    <InkScreen>
      {/* 1. 运行模式与同步 */}
      <InkSectionLabel title={localMode ? "运行模式" : "同步与连接"} />
      <InkCard variant="compact">
        {localMode ? (
          <div className="mk-row">
            <div className="mk-row-main">
              <div className="mk-row-title">仅本机模式</div>
              <div className="mk-row-sub">
                数据保存在手机本地，无需服务器 · 建议定期导出备份
              </div>
            </div>
            <div className="mk-row-right">
              <span className="mfx-dot live" />
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mk-row"
            onClick={() => void handleSyncTap()}
          >
            <div className="mk-row-main">
              <div className="mk-row-title">
                {syncingNow ? "同步中…" : syncInfo.label}
              </div>
              <div className="mk-row-sub">
                {pending.length > 0
                  ? `${syncStatus.message} · 待同步 ${pending.length} 条`
                  : "轻触立即与服务器同步"}
              </div>
            </div>
            <div className="mk-row-right">
              <span className={`mfx-dot ${syncInfo.tone}`} />
              <span className={syncingNow ? "mfx-spin" : ""}>
                <Icon name="sync" size={16} />
              </span>
            </div>
          </button>
        )}

        {android && (
          <>
            <InkHairline />
            <button
              type="button"
              className="mk-row"
              onClick={() => openAndroidEndpointSettings()}
            >
              <div className="mk-row-main">
                <div className="mk-row-title">
                  {localMode ? "连接我的服务器" : "模式与服务器设置"}
                </div>
                <div className="mk-row-sub">
                  {localMode
                    ? "未来自建服务器时，先导出备份再连接并导入迁移"
                    : "切换仅本机模式、修改服务地址与配对"}
                </div>
              </div>
              <div className="mk-row-right">
                <span className="mk-row-chevron">
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
            </button>
          </>
        )}

        {conflicts.length > 0 && (
          <>
            <InkHairline />
            <button
              type="button"
              className="mk-row"
              onClick={() => setSubPage("conflicts")}
            >
              <div className="mk-row-main">
                <div className="mk-row-title">
                  待处理冲突 ({conflicts.length})
                </div>
                <div className="mk-row-sub warn">
                  另一端也修改了记录，请核对保留版本
                </div>
              </div>
              <div className="mk-row-right">
                <span className="mfx-badge warn">{conflicts.length}</span>
                <span className="mk-row-chevron">
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
            </button>
          </>
        )}

        {conflicts.length === 0 && queued.length > 0 && (
          <>
            <InkHairline />
            <button
              type="button"
              className="mk-row"
              onClick={() => setSubPage("conflicts")}
            >
              <div className="mk-row-main">
                <div className="mk-row-title">本机待发送 ({queued.length})</div>
                <div className="mk-row-sub">联网后自动上传，也可查看或撤销</div>
              </div>
              <div className="mk-row-right">
                <span className="mfx-badge">{queued.length}</span>
                <span className="mk-row-chevron">
                  <Icon name="chevron-right" size={16} />
                </span>
              </div>
            </button>
          </>
        )}
      </InkCard>

      {/* 2. 外观 */}
      <InkSectionLabel title="外观" />
      <InkCard variant="tight">
        <InkSegmented
          onCard
          value={normalizedTheme}
          onChange={(next) => setTheme(next)}
          options={[
            { value: "dark", label: "深色" },
            { value: "light", label: "浅色" },
            { value: "system", label: "跟随系统" },
          ]}
        />
      </InkCard>

      {/* 3. 工作区与模块 */}
      <InkSectionLabel title="工作区与模块" />
      <InkCard variant="compact">
        <button
          type="button"
          className="mk-row"
          onClick={() => setSubPage("workspace")}
        >
          <div className="mk-row-main">
            <div className="mk-row-title">工作区设置</div>
            <div className="mk-row-sub">
              预设、模块开关与自定义名称（跨端同步）
            </div>
          </div>
          <div className="mk-row-right">
            <span>
              {PRESET_TITLES[ws.preset] ?? "自定义"} · {enabledCount}/
              {TOGGLEABLE_FEATURES.length}
            </span>
            <span className="mk-row-chevron">
              <Icon name="chevron-right" size={16} />
            </span>
          </div>
        </button>
      </InkCard>

      {/* 4. 数据 */}
      <InkSectionLabel title="数据与备份" />
      <InkCard variant="compact">
        <button
          type="button"
          className="mk-row"
          disabled={exporting}
          onClick={() => void handleExport()}
        >
          <div className="mk-row-main">
            <div className="mk-row-title">
              {exporting ? "正在导出备份…" : "导出全部备份 (JSON)"}
            </div>
            <div className="mk-row-sub">
              {exportNote || `当前本机已保存 ${overview.live} 条记录`}
            </div>
          </div>
          <div className="mk-row-right">
            <Icon name="download" size={17} />
          </div>
        </button>

        <InkHairline />

        <button
          type="button"
          className="mk-row"
          disabled={importingNow}
          onClick={() => importInputRef.current?.click()}
        >
          <div className="mk-row-main">
            <div className="mk-row-title">
              {importingNow ? "正在导入备份…" : "导入备份恢复 (JSON)"}
            </div>
            <div
              className={
                "mk-row-sub" + (importError ? " danger" : importNote ? " live" : "")
              }
            >
              {importError ||
                importNote ||
                "从 SELF OS 备份文件恢复或合并数据"}
            </div>
          </div>
          <div className="mk-row-right">
            <Icon name="upload" size={17} />
          </div>
        </button>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          aria-label="选择备份 JSON 文件"
          style={{ display: "none" }}
          onChange={(e) => void handlePickImportFile(e)}
        />

        <InkHairline />

        <button
          type="button"
          className="mk-row"
          onClick={() => setSubPage("trash")}
        >
          <div className="mk-row-main">
            <div className="mk-row-title">回收站</div>
            <div className="mk-row-sub">查看并恢复已删除的记录</div>
          </div>
          <div className="mk-row-right">
            {overview.deleted > 0 && (
              <span className="mfx-badge">{overview.deleted}</span>
            )}
            <span className="mk-row-chevron">
              <Icon name="chevron-right" size={16} />
            </span>
          </div>
        </button>
      </InkCard>

      <p className="mfx-footnote">
        {localMode
          ? "当前为仅本机模式，所有数据均保存在这台设备中；卸载软件或更换手机前请先导出 JSON 备份。"
          : "模块开关与名称定制会自动同步到 Mac、Web 与手机；外观主题保存在当前设备。"}
      </p>

      <InkSheet
        open={importCandidate !== null}
        title="导入备份"
        onClose={() => {
          if (!importingNow) setImportCandidate(null);
        }}
        rightLabel={importingNow ? "导入中…" : "确认导入"}
        rightDisabled={importingNow}
        onRight={() => {
          if (localMode && importStrategy === "replace") {
            setConfirmReplace(true);
          } else {
            void executeImport();
          }
        }}
      >
        {importCandidate && (
          <>
            <div className="mk-form-group">
              <div className="mk-form-row">
                <span className="mk-form-label">导出时间</span>
                <span style={{ fontSize: 14, color: "var(--text)" }}>
                  {importCandidate.exportedAt.slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <div className="mk-form-row">
                <span className="mk-form-label">有效记录</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                  {importCandidate.liveCount} 条
                </span>
              </div>
              {importCandidate.deletedCount > 0 && (
                <div className="mk-form-row">
                  <span className="mk-form-label">回收站记录</span>
                  <span style={{ fontSize: 14, color: "var(--text-2)" }}>
                    {importCandidate.deletedCount} 条
                  </span>
                </div>
              )}
              {importCandidate.skippedInvalid > 0 && (
                <div className="mk-form-row">
                  <span className="mk-form-label">已跳过无效条目</span>
                  <span style={{ fontSize: 14, color: "var(--warn)" }}>
                    {importCandidate.skippedInvalid} 条
                  </span>
                </div>
              )}
            </div>

            {Object.keys(importCandidate.byType).length > 0 && (
              <div className="mk-flow-chips">
                {Object.entries(importCandidate.byType)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 10)
                  .map(([type, count]) => (
                    <span key={type} className="mk-chip sm">
                      {KIND_LABELS[type] ?? type} {count}
                    </span>
                  ))}
              </div>
            )}

            {localMode ? (
              <>
                <div className="mk-section-label">导入方式</div>
                <InkSegmented
                  onCard
                  value={importStrategy}
                  onChange={setImportStrategy}
                  options={[
                    { value: "merge", label: "合并导入" },
                    { value: "replace", label: "覆盖恢复" },
                  ]}
                />
                <p className="mfx-footnote" style={{ marginTop: 0 }}>
                  {importStrategy === "merge"
                    ? "保留本机已有记录，补齐缺失条目，并按更新时间保留较新版本。"
                    : "清空本机当前全部记录，完全还原为这份备份文件里的状态（建议先导出当前数据）。"}
                </p>
              </>
            ) : (
              <p className="mfx-footnote" style={{ marginTop: 0 }}>
                当前已连接服务器，将自动以「合并导入」方式按依赖顺序写入并同步到其他设备，不会清空服务器已有数据。
              </p>
            )}

            {importError && (
              <div style={{ color: "var(--danger)", fontSize: 13 }}>
                {importError}
              </div>
            )}
          </>
        )}
      </InkSheet>

      <InkActionSheet
        open={confirmReplace}
        title="确认清空本机当前全部记录并完全覆盖为所选备份？此操作不可撤销。"
        onClose={() => setConfirmReplace(false)}
        items={[
          {
            label: "确认覆盖恢复",
            danger: true,
            onClick: () => void executeImport(),
          },
        ]}
      />
    </InkScreen>
  );
}

/* ─────────────────────────── SubPage: Workspace Settings ─────────────────────────── */

function WorkspaceSubPage({
  ws,
  onBack,
  onOpenAliases,
}: {
  ws: ReturnType<typeof useWorkspaceConfig>;
  onBack: () => void;
  onOpenAliases: () => void;
}) {
  const [renaming, setRenaming] = useState<
    | { kind: "feature"; key: string; original: string; current: string }
    | { kind: "department"; key: string; original: string; current: string }
    | null
  >(null);
  const [aliasInput, setAliasInput] = useState("");

  const enabledCount = TOGGLEABLE_FEATURES.filter((k) => ws.isEnabled(k)).length;
  const aliasCount =
    Object.keys(ws.featureAliases).length +
    Object.keys(ws.departmentAliases).length;

  const activePresetMeta = PRESET_LIST.find((p) => p.id === ws.preset);

  function openRename(
    kind: "feature" | "department",
    key: string,
    original: string,
    current: string,
  ) {
    setRenaming({ kind, key, original, current });
    setAliasInput(current === original ? "" : current);
  }

  function commitRename() {
    if (!renaming) return;
    if (renaming.kind === "feature") {
      perform(ws.setFeatureAlias(renaming.key, aliasInput));
    } else {
      perform(ws.setDepartmentAlias(renaming.key, aliasInput));
    }
    setRenaming(null);
  }

  return (
    <MobileSubPage title="工作区设置" onBack={onBack}>
      <InkScreen>
        <InkSectionLabel title="一键预设" aside="跨端自动同步" />
        <InkChipBar
          value={ws.preset}
          onChange={(val) => {
            if (val === "council" || val === "standard" || val === "minimal") {
              perform(ws.applyPreset(val));
            }
          }}
          items={[
            ...PRESET_LIST.map((p) => ({
              value: p.id as string,
              label: p.title,
            })),
            ...(ws.preset === "custom"
              ? [{ value: "custom", label: "自定义" }]
              : []),
          ]}
        />

        <div className="mfx-preset-desc">
          <div className="mfx-preset-desc-head">
            <strong>{activePresetMeta?.title ?? "自定义配置"}</strong>
            <small>
              {activePresetMeta?.badge ??
                `已启用 ${enabledCount}/${TOGGLEABLE_FEATURES.length} 模块`}
            </small>
          </div>
          <p>
            {activePresetMeta?.description ??
              "按个人偏好单独开关模块与部门。关闭模块只会隐藏入口，不会删除任何历史数据。"}
          </p>
        </div>

        <InkSectionLabel title="命名定制" />
        <InkCard variant="compact">
          <button type="button" className="mk-row" onClick={onOpenAliases}>
            <div className="mk-row-main">
              <div className="mk-row-title">自定义模块与部门名称</div>
              <div className="mk-row-sub">批量编辑别名或恢复默认原名</div>
            </div>
            <div className="mk-row-right">
              <span>{aliasCount > 0 ? `已改 ${aliasCount} 项` : "默认原名"}</span>
              <span className="mk-row-chevron">
                <Icon name="chevron-right" size={16} />
              </span>
            </div>
          </button>
        </InkCard>

        <InkSectionLabel title="内置部门显示" />
        <InkCard variant="compact">
          {BUILTIN_DEPARTMENTS.map((dept, index) => {
            const visible = ws.isDepartmentVisible(dept);
            const shown = ws.departmentLabel(dept);
            return (
              <React.Fragment key={dept}>
                {index > 0 && <InkHairline />}
                <div className="mfx-ws-row">
                  <button
                    type="button"
                    className="mfx-ws-leading"
                    onClick={() => openRename("department", dept, dept, shown)}
                  >
                    <div className="mk-row-main">
                      <div className="mk-row-title clamp-1">{shown}</div>
                      {shown !== dept && (
                        <div className="mk-row-sub">原名：{dept}</div>
                      )}
                    </div>
                  </button>
                  <div className="mfx-ws-actions">
                    <button
                      type="button"
                      className="mfx-icon-btn"
                      aria-label={`重命名 ${shown}`}
                      onClick={() => openRename("department", dept, dept, shown)}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <InkSwitch
                      checked={visible}
                      label={`显示 ${shown}`}
                      onChange={() => perform(ws.toggleDepartment(dept))}
                    />
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </InkCard>

        <InkSectionLabel
          title="功能模块开关"
          aside={`已启用 ${enabledCount}/${TOGGLEABLE_FEATURES.length}`}
        />
        <InkCard variant="compact">
          {TOGGLEABLE_FEATURES.map((key, index) => {
            const f = feature(key);
            const on = ws.isEnabled(key);
            const shown = ws.labelOf(key);
            return (
              <React.Fragment key={key}>
                {index > 0 && <InkHairline />}
                <div className="mfx-ws-row">
                  <button
                    type="button"
                    className="mfx-ws-leading"
                    onClick={() => openRename("feature", key, f.name, shown)}
                  >
                    <span className={"mfx-ws-icon" + (on ? "" : " off")}>
                      <Icon name={key} size={17} />
                    </span>
                    <div className="mk-row-main">
                      <div
                        className="mk-row-title clamp-1"
                        style={{ color: on ? "var(--text)" : "var(--text-3)" }}
                      >
                        {shown}
                      </div>
                      {shown !== f.name && (
                        <div className="mk-row-sub">原名：{f.name}</div>
                      )}
                    </div>
                  </button>
                  <div className="mfx-ws-actions">
                    <button
                      type="button"
                      className="mfx-icon-btn"
                      aria-label={`重命名 ${shown}`}
                      onClick={() => openRename("feature", key, f.name, shown)}
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <InkSwitch
                      checked={on}
                      label={`启用 ${shown}`}
                      onChange={() => perform(ws.toggleFeature(key))}
                    />
                  </div>
                </div>
              </React.Fragment>
            );
          })}
        </InkCard>

        <p className="mfx-footnote">
          关闭模块只会隐藏入口，不会删除任何历史数据，随时可重新打开。
        </p>

        <InkSheet
          open={Boolean(renaming)}
          title={renaming ? `重命名「${renaming.original}」` : "重命名"}
          onClose={() => setRenaming(null)}
          rightLabel="保存"
          onRight={commitRename}
        >
          <div className="mk-form-group">
            <div className="mk-form-row">
              <span className="mk-form-label">原名</span>
              <span className="mk-row-sub">{renaming?.original}</span>
            </div>
            <div className="mk-form-row">
              <span className="mk-form-label">显示名</span>
              <input
                className="mk-form-input right"
                maxLength={40}
                placeholder="留空恢复默认原名"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                }}
              />
            </div>
          </div>
          {aliasInput.trim() !== "" && (
            <button
              type="button"
              className="mk-pill full"
              onClick={() => setAliasInput("")}
            >
              清空并恢复原名
            </button>
          )}
        </InkSheet>
      </InkScreen>
    </MobileSubPage>
  );
}

/* ─────────────────────────── SubPage: Workspace Aliases ─────────────────────────── */

function WorkspaceAliasesSubPage({
  ws,
  onBack,
}: {
  ws: ReturnType<typeof useWorkspaceConfig>;
  onBack: () => void;
}) {
  const [deptDrafts, setDeptDrafts] = useState<Record<string, string>>(
    () => ({ ...ws.departmentAliases }),
  );
  const [featureDrafts, setFeatureDrafts] = useState<Record<string, string>>(
    () => ({ ...ws.featureAliases }),
  );
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const hasAnyAlias =
    Object.keys(ws.featureAliases).length > 0 ||
    Object.keys(ws.departmentAliases).length > 0;

  async function saveAllAliases() {
    if (saving) return;
    setSaving(true);
    try {
      const cleanDepts: Record<string, string> = {};
      for (const name of BUILTIN_DEPARTMENTS) {
        const clean = (deptDrafts[name] ?? "").trim().slice(0, 40);
        if (clean && clean !== name) cleanDepts[name] = clean;
      }
      const cleanFeatures: Record<string, string> = {};
      for (const key of TOGGLEABLE_FEATURES) {
        const clean = (featureDrafts[key] ?? "").trim().slice(0, 40);
        if (clean && clean !== feature(key).name) cleanFeatures[key] = clean;
      }
      const base: Data = ws.record ? { ...ws.record.data } : {};
      const next: Data = {
        ...base,
        departmentAliases: stringifyAliasMap(cleanDepts),
        featureAliases: stringifyAliasMap(cleanFeatures),
      };
      if (!ws.record) {
        await put("workspaceConfig", next, { id: WORKSPACE_CONFIG_ID });
      } else {
        await saveEdit("workspaceConfig", ws.record.id, ws.record.data, next);
      }
      onBack();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <MobileSubPage
        title="自定义名称"
        onBack={onBack}
        right={
          <InkNavText
            label={saving ? "保存中" : "保存"}
            solid
            disabled={saving}
            onClick={() => perform(saveAllAliases())}
          />
        }
      >
        <InkScreen>
          <InkSectionLabel title="内置部门名称" />
          <div className="mk-form-group">
            {BUILTIN_DEPARTMENTS.map((dept) => (
              <div className="mk-form-row" key={dept}>
                <span className="mk-form-label">{dept}</span>
                <input
                  className="mk-form-input right"
                  maxLength={40}
                  placeholder="留空使用原名"
                  value={deptDrafts[dept] ?? ""}
                  onChange={(e) =>
                    setDeptDrafts((prev) => ({
                      ...prev,
                      [dept]: e.target.value,
                    }))
                  }
                />
              </div>
            ))}
          </div>

          <InkSectionLabel title="功能模块名称" />
          <div className="mk-form-group">
            {TOGGLEABLE_FEATURES.map((key) => {
              const f = feature(key);
              return (
                <div className="mk-form-row" key={key}>
                  <span
                    className="mk-form-label"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <Icon name={key} size={15} />
                    <span>{f.name}</span>
                  </span>
                  <input
                    className="mk-form-input right"
                    maxLength={40}
                    placeholder="留空用原名"
                    value={featureDrafts[key] ?? ""}
                    onChange={(e) =>
                      setFeatureDrafts((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>

          <p className="mfx-footnote">
            自定义名称会同步到 Mac、Web 与手机；清空任意一项即可恢复默认原名。
          </p>

          {hasAnyAlias && (
            <button
              type="button"
              className="mk-pill danger lg full"
              onClick={() => setConfirmReset(true)}
            >
              恢复全部默认原名
            </button>
          )}
        </InkScreen>
      </MobileSubPage>

      <InkActionSheet
        open={confirmReset}
        title="恢复所有部门与模块的默认原名？"
        onClose={() => setConfirmReset(false)}
        items={[
          {
            label: "恢复全部默认原名",
            icon: "undo",
            danger: true,
            onClick: () => {
              perform(
                ws.resetAllAliases().then(() => {
                  setDeptDrafts({});
                  setFeatureDrafts({});
                }),
              );
            },
          },
        ]}
      />
    </>
  );
}

/* ─────────────────────────── SubPage: Conflicts & Pending ─────────────────────────── */

function ConflictsSubPage({
  pending,
  conflicts,
  queued,
  onBack,
}: {
  pending: Pending[];
  conflicts: Pending[];
  queued: Pending[];
  onBack: () => void;
}) {
  return (
    <MobileSubPage
      title={conflicts.length > 0 ? "待处理冲突" : "本机待发送"}
      onBack={onBack}
    >
      <InkScreen>
        {conflicts.length > 0 && (
          <>
            <InkSectionLabel
              title="需要核对的同步记录"
              aside={`${conflicts.length} 条`}
            />
            {conflicts.map((op) => {
              const batchMembers = op.batchId
                ? pending.filter((m) => m.batchId === op.batchId)
                : [];
              const isTransferBatch =
                Boolean(op.batchId) &&
                batchMembers.some((m) => m.entityType === "idea") &&
                batchMembers.some((m) => m.entityType === "journal");

              const reason = isTransferBatch
                ? "另一端已修改原文，此次「想法 ↔ 原料」迁移未生效。请采用服务器版本后打开最新原文重新选段。"
                : op.recoveryDraft
                  ? op.error ?? "本机草稿与服务器状态不一致"
                  : op.state === "error"
                    ? `无法提交：${op.error ?? "内容需要检查"}`
                    : "另一端已经修改这条记录，本机版本仍被保留。";

              const localPreview = op.recoveryDraft
                ? op.recoveryDraft.deleted
                  ? "删除记录"
                  : String(
                      op.recoveryDraft.data.body ??
                        op.recoveryDraft.data.title ??
                        op.recoveryDraft.data.name ??
                        op.recoveryDraft.type,
                    )
                : null;

              const serverPreview = op.server
                ? String(
                    op.server.data.body ??
                      op.server.data.title ??
                      op.server.data.name ??
                      "",
                  )
                : null;

              return (
                <InkCard key={op.operationId} variant="tight">
                  <div className="mk-row-main">
                    <div className="mk-row-title">{pendingTitle(op)}</div>
                    <div className="mk-row-sub warn">
                      {KIND_LABELS[op.entityType] ?? op.entityType} · {reason}
                    </div>
                  </div>

                  {localPreview && (
                    <blockquote className="mfx-quote">
                      <span className="mfx-quote-label">本机草稿</span>
                      {localPreview.slice(0, 300)}
                    </blockquote>
                  )}

                  {serverPreview && (
                    <blockquote className="mfx-quote">
                      <span className="mfx-quote-label">服务器版本</span>
                      {serverPreview.slice(0, 300)}
                    </blockquote>
                  )}

                  <div className="mfx-action-strip">
                    {!isTransferBatch && (
                      <button
                        type="button"
                        className="mk-pill solid sm"
                        onClick={() => perform(settle(op.entityId, true))}
                      >
                        保留本机
                      </button>
                    )}
                    <button
                      type="button"
                      className="mk-pill sm"
                      onClick={() => perform(settle(op.entityId, false))}
                    >
                      {isTransferBatch
                        ? "采用服务器（之后重选）"
                        : "采用服务器"}
                    </button>
                  </div>
                </InkCard>
              );
            })}
          </>
        )}

        {queued.length > 0 && (
          <>
            <InkSectionLabel
              title="等待发送"
              aside={`${queued.length} 条`}
            />
            <InkCard variant="compact">
              {queued.map((op, index) => (
                <React.Fragment key={op.operationId}>
                  {index > 0 && <InkHairline />}
                  <div className="mk-row">
                    <div className="mk-row-main">
                      <div className="mk-row-title clamp-1">
                        {pendingTitle(op)}
                      </div>
                      <div className="mk-row-sub">
                        {KIND_LABELS[op.entityType] ?? op.entityType} ·{" "}
                        {op.state === "sending" ? "正在发送" : "等待同步"}
                      </div>
                    </div>
                    {op.state === "queued" && (
                      <button
                        type="button"
                        className="mk-pill sm"
                        onClick={() => perform(undoPending(op.entityId))}
                      >
                        撤销
                      </button>
                    )}
                  </div>
                </React.Fragment>
              ))}
            </InkCard>
          </>
        )}

        {conflicts.length === 0 && queued.length === 0 && (
          <InkCard>
            <InkEmpty text="全部已同步，没有待处理的冲突" />
          </InkCard>
        )}
      </InkScreen>
    </MobileSubPage>
  );
}

/* ─────────────────────────── SubPage: Recycle Bin ─────────────────────────── */

function RecycleBinSubPage({ onBack }: { onBack: () => void }) {
  const all = useEverything(true);
  const [search, setSearch] = useState("");

  const tombstones = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all
      .filter((e) => {
        if (!e.deleted) return false;
        if (!q) return true;
        const label = KIND_LABELS[e.type] ?? e.type;
        return (
          entityTitle(e).toLowerCase().includes(q) ||
          label.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [all, search]);

  return (
    <MobileSubPage title="回收站" onBack={onBack}>
      <InkScreen>
        <InkSearch
          value={search}
          onChange={setSearch}
          placeholder="搜索已删除记录…"
        />

        <InkCard variant="compact">
          {tombstones.map((e, index) => (
            <React.Fragment key={e.id}>
              {index > 0 && <InkHairline />}
              <div className="mk-row">
                <div className="mk-row-main">
                  <div className="mk-row-title clamp-1">{entityTitle(e)}</div>
                  <div className="mk-row-sub">
                    {KIND_LABELS[e.type] ?? e.type} · {e.updatedAt.slice(0, 10)}
                  </div>
                </div>
                <button
                  type="button"
                  className="mk-pill sm"
                  onClick={() => perform(put(e.type, e.data, e))}
                >
                  恢复
                </button>
              </div>
            </React.Fragment>
          ))}

          {tombstones.length === 0 && (
            <InkEmpty
              text={search.trim() ? "没有匹配的已删除记录" : "回收站是空的"}
            />
          )}
        </InkCard>
      </InkScreen>
    </MobileSubPage>
  );
}
