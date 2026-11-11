// Generated from packages/contracts/schema.ts by scripts/generate-contracts.ts. Do not edit.
import Foundation

public enum FieldKind: String, Sendable {
  case string, choice, day, month, timestamp, money, decimal, integer, number, boolean, ref, strings
}
public struct FieldSpec: Sendable {
  public let name: String
  /** Column in the local table. */
  public let column: String
  public let kind: FieldKind
  public let required: Bool
  /** SQLite storage class of the column. */
  public let storage: String
  public var values: [String] = []
  public var target: String? = nil
  public var minimum: Double? = nil
  public var maximum: Double? = nil
}
public struct EntitySpec: Sendable {
  public let type: String
  public let module: String
  public let table: String
  public let fields: [FieldSpec]
  public func field(_ name: String) -> FieldSpec? { fields.first { $0.name == name } }
}
public enum EntityType: String, Codable, Sendable, CaseIterable {
  case department
  case domain
  case activity
  case problem
  case solution
  case session
  case progress
  case task
  case checklist
  case checklistRun
  case habit
  case habitRule
  case habitLog
  case budget
  case category
  case expense
  case recurringExpense
  case wallet
  case asset
  case assetPrice
  case walletEntry
  case document
  case journal
  case idea
  case metric
  case metricLog
  case importantDay
}
public enum EntitySchema {
  public static let all: [EntitySpec] = [
    EntitySpec(type: "department", module: "workspace", table: "workspace_departments", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "features", column: "features", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "domain", module: "practice", table: "practice_domains", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "focused", column: "focused", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "order", column: "order", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
      FieldSpec(name: "goal", column: "goal", kind: .string, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "activity", module: "practice", table: "practice_activities", fields: [
      FieldSpec(name: "domainId", column: "domain_id", kind: .ref, required: true, storage: "TEXT", target: "domain"),
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "archived", column: "archived", kind: .boolean, required: false, storage: "INTEGER"),
    ]),
    EntitySpec(type: "problem", module: "practice", table: "practice_problems", fields: [
      FieldSpec(name: "domainId", column: "domain_id", kind: .ref, required: true, storage: "TEXT", target: "domain"),
      FieldSpec(name: "activityId", column: "activity_id", kind: .ref, required: false, storage: "TEXT", target: "activity"),
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["pending", "active", "resolved", "discarded"]),
      FieldSpec(name: "focused", column: "focused", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "note", column: "note", kind: .string, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "solution", module: "practice", table: "practice_solutions", fields: [
      FieldSpec(name: "problemId", column: "problem_id", kind: .ref, required: true, storage: "TEXT", target: "problem"),
      FieldSpec(name: "parentId", column: "parent_id", kind: .ref, required: false, storage: "TEXT", target: "solution"),
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["pending", "active", "resolved", "discarded"]),
      FieldSpec(name: "reason", column: "reason", kind: .string, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "session", module: "practice", table: "practice_sessions", fields: [
      FieldSpec(name: "domainId", column: "domain_id", kind: .ref, required: true, storage: "TEXT", target: "domain"),
      FieldSpec(name: "activityId", column: "activity_id", kind: .ref, required: false, storage: "TEXT", target: "activity"),
      FieldSpec(name: "problemId", column: "problem_id", kind: .ref, required: false, storage: "TEXT", target: "problem"),
      FieldSpec(name: "solutionId", column: "solution_id", kind: .ref, required: false, storage: "TEXT", target: "solution"),
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "startedAt", column: "started_at", kind: .timestamp, required: false, storage: "TEXT"),
      FieldSpec(name: "endedAt", column: "ended_at", kind: .timestamp, required: false, storage: "TEXT"),
      FieldSpec(name: "elapsedSeconds", column: "elapsed_seconds", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
      FieldSpec(name: "runningSince", column: "running_since", kind: .timestamp, required: false, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["running", "paused", "finished", "cancelled"]),
      FieldSpec(name: "note", column: "note", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "manual", column: "manual", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "segments", column: "segments", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "progress", module: "practice", table: "practice_progress", fields: [
      FieldSpec(name: "domainId", column: "domain_id", kind: .ref, required: true, storage: "TEXT", target: "domain"),
      FieldSpec(name: "activityId", column: "activity_id", kind: .ref, required: false, storage: "TEXT", target: "activity"),
      FieldSpec(name: "problemId", column: "problem_id", kind: .ref, required: false, storage: "TEXT", target: "problem"),
      FieldSpec(name: "solutionId", column: "solution_id", kind: .ref, required: false, storage: "TEXT", target: "solution"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "body", column: "body", kind: .string, required: true, storage: "TEXT"),
    ]),
    EntitySpec(type: "task", module: "tasks", table: "tasks", fields: [
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["pending", "completed", "discarded"]),
      FieldSpec(name: "scheduleKind", column: "schedule_kind", kind: .choice, required: true, storage: "TEXT", values: ["unscheduled", "recent", "day", "deadline", "range"]),
      FieldSpec(name: "scheduleDate", column: "schedule_date", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "scheduleStart", column: "schedule_start", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "scheduleEnd", column: "schedule_end", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "createdAt", column: "created_at", kind: .timestamp, required: false, storage: "TEXT"),
      FieldSpec(name: "completedAt", column: "completed_at", kind: .timestamp, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "checklist", module: "tasks", table: "preparation_checklists", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "items", column: "items", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "checklistRun", module: "tasks", table: "preparation_runs", fields: [
      FieldSpec(name: "checklistId", column: "checklist_id", kind: .ref, required: true, storage: "TEXT", target: "checklist"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "checked", column: "checked", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "habit", module: "habits", table: "habit_definitions", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "kind", column: "kind", kind: .choice, required: true, storage: "TEXT", values: ["binary", "quantity", "checklist"]),
      FieldSpec(name: "unit", column: "unit", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "items", column: "items", kind: .strings, required: false, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["active", "paused", "optional", "archived"]),
      FieldSpec(name: "showHome", column: "show_home", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "order", column: "order", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
    ]),
    EntitySpec(type: "habitRule", module: "habits", table: "habit_rules", fields: [
      FieldSpec(name: "habitId", column: "habit_id", kind: .ref, required: true, storage: "TEXT", target: "habit"),
      FieldSpec(name: "effectiveFrom", column: "effective_from", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "target", column: "target", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
      FieldSpec(name: "weekdays", column: "weekdays", kind: .strings, required: false, storage: "TEXT"),
      FieldSpec(name: "kind", column: "kind", kind: .choice, required: false, storage: "TEXT", values: ["binary", "quantity", "checklist"]),
      FieldSpec(name: "unit", column: "unit", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "items", column: "items", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "habitLog", module: "habits", table: "habit_logs", fields: [
      FieldSpec(name: "habitId", column: "habit_id", kind: .ref, required: true, storage: "TEXT", target: "habit"),
      FieldSpec(name: "ruleId", column: "rule_id", kind: .ref, required: false, storage: "TEXT", target: "habitRule"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "value", column: "value", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
      FieldSpec(name: "items", column: "items", kind: .strings, required: false, storage: "TEXT"),
      FieldSpec(name: "hidden", column: "hidden", kind: .boolean, required: false, storage: "INTEGER"),
    ]),
    EntitySpec(type: "budget", module: "finance", table: "expense_budgets", fields: [
      FieldSpec(name: "month", column: "month", kind: .month, required: true, storage: "TEXT"),
      FieldSpec(name: "amountMinor", column: "amount_minor", kind: .money, required: true, storage: "INTEGER"),
    ]),
    EntitySpec(type: "category", module: "finance", table: "expense_categories", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "parentId", column: "parent_id", kind: .ref, required: false, storage: "TEXT", target: "category"),
      FieldSpec(name: "necessary", column: "necessary", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "defaultChildId", column: "default_child_id", kind: .ref, required: false, storage: "TEXT", target: "category"),
    ]),
    EntitySpec(type: "expense", module: "finance", table: "expense_entries", fields: [
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "amountMinor", column: "amount_minor", kind: .money, required: true, storage: "INTEGER"),
      FieldSpec(name: "categoryId", column: "category_id", kind: .ref, required: false, storage: "TEXT", target: "category"),
      FieldSpec(name: "subcategoryId", column: "subcategory_id", kind: .ref, required: false, storage: "TEXT", target: "category"),
      FieldSpec(name: "necessary", column: "necessary", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "mode", column: "mode", kind: .choice, required: true, storage: "TEXT", values: ["immediate", "estimated", "fixed"]),
      FieldSpec(name: "startDay", column: "start_day", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "endDay", column: "end_day", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "endedDay", column: "ended_day", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "recoveryMinor", column: "recovery_minor", kind: .money, required: false, storage: "INTEGER"),
      FieldSpec(name: "recoveryDay", column: "recovery_day", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "note", column: "note", kind: .string, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "recurringExpense", module: "finance", table: "recurring_expenses", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "amountMinor", column: "amount_minor", kind: .money, required: true, storage: "INTEGER"),
      FieldSpec(name: "categoryId", column: "category_id", kind: .ref, required: false, storage: "TEXT", target: "category"),
      FieldSpec(name: "active", column: "active", kind: .boolean, required: false, storage: "INTEGER"),
    ]),
    EntitySpec(type: "wallet", module: "treasury", table: "treasury_wallets", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "category", column: "category", kind: .choice, required: true, storage: "TEXT", values: ["cny", "external", "crypto", "stock"]),
      FieldSpec(name: "asset", column: "asset", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "currency", column: "currency", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "unitPrice", column: "unit_price", kind: .decimal, required: false, storage: "TEXT"),
      FieldSpec(name: "exchangeRate", column: "exchange_rate", kind: .decimal, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "asset", module: "treasury", table: "treasury_assets", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "symbol", column: "symbol", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "kind", column: "kind", kind: .choice, required: true, storage: "TEXT", values: ["crypto", "stock"]),
      FieldSpec(name: "quoteId", column: "quote_id", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "currency", column: "currency", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "manualPrice", column: "manual_price", kind: .decimal, required: false, storage: "TEXT"),
      FieldSpec(name: "order", column: "order", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
    ]),
    EntitySpec(type: "assetPrice", module: "treasury", table: "treasury_asset_prices", fields: [
      FieldSpec(name: "assetId", column: "asset_id", kind: .ref, required: true, storage: "TEXT", target: "asset"),
      FieldSpec(name: "at", column: "at", kind: .timestamp, required: true, storage: "TEXT"),
      FieldSpec(name: "price", column: "price", kind: .decimal, required: true, storage: "TEXT"),
    ]),
    EntitySpec(type: "walletEntry", module: "treasury", table: "treasury_entries", fields: [
      FieldSpec(name: "walletId", column: "wallet_id", kind: .ref, required: true, storage: "TEXT", target: "wallet"),
      FieldSpec(name: "assetId", column: "asset_id", kind: .ref, required: false, storage: "TEXT", target: "asset"),
      FieldSpec(name: "mode", column: "mode", kind: .choice, required: true, storage: "TEXT", values: ["set", "delta"]),
      FieldSpec(name: "quantity", column: "quantity", kind: .decimal, required: true, storage: "TEXT"),
      FieldSpec(name: "at", column: "at", kind: .timestamp, required: true, storage: "TEXT"),
      FieldSpec(name: "reason", column: "reason", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "unitPrice", column: "unit_price", kind: .decimal, required: false, storage: "TEXT"),
      FieldSpec(name: "exchangeRate", column: "exchange_rate", kind: .decimal, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "document", module: "documents", table: "documents", fields: [
      FieldSpec(name: "title", column: "title", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "body", column: "body", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "kind", column: "kind", kind: .choice, required: true, storage: "TEXT", values: ["note", "thought", "monthly"]),
      FieldSpec(name: "day", column: "day", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "month", column: "month", kind: .month, required: false, storage: "TEXT"),
      FieldSpec(name: "domainId", column: "domain_id", kind: .ref, required: false, storage: "TEXT", target: "domain"),
      FieldSpec(name: "activityId", column: "activity_id", kind: .ref, required: false, storage: "TEXT", target: "activity"),
      FieldSpec(name: "source", column: "source", kind: .choice, required: false, storage: "TEXT", values: ["unknown", "original", "ai", "assisted", "excerpt"]),
      FieldSpec(name: "tags", column: "tags", kind: .strings, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "journal", module: "journal", table: "journal_entries", fields: [
      FieldSpec(name: "kind", column: "kind", kind: .choice, required: true, storage: "TEXT", values: ["chronicle", "raw"]),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "body", column: "body", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "complete", column: "complete", kind: .boolean, required: false, storage: "INTEGER"),
    ]),
    EntitySpec(type: "idea", module: "journal", table: "idea_entries", fields: [
      FieldSpec(name: "body", column: "body", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "status", column: "status", kind: .choice, required: true, storage: "TEXT", values: ["pending", "completed", "discarded"]),
    ]),
    EntitySpec(type: "metric", module: "metrics", table: "metric_definitions", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "unit", column: "unit", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "minimum", column: "minimum", kind: .number, required: false, storage: "REAL", minimum: -100000, maximum: 1000000000000),
      FieldSpec(name: "maximum", column: "maximum", kind: .number, required: false, storage: "REAL", minimum: 0, maximum: 1000000000000),
    ]),
    EntitySpec(type: "metricLog", module: "metrics", table: "metric_entries", fields: [
      FieldSpec(name: "metricId", column: "metric_id", kind: .ref, required: true, storage: "TEXT", target: "metric"),
      FieldSpec(name: "day", column: "day", kind: .day, required: true, storage: "TEXT"),
      FieldSpec(name: "value", column: "value", kind: .number, required: false, storage: "REAL", minimum: -100000, maximum: 1000000000000),
      FieldSpec(name: "note", column: "note", kind: .string, required: false, storage: "TEXT"),
    ]),
    EntitySpec(type: "importantDay", module: "calendar", table: "important_days", fields: [
      FieldSpec(name: "name", column: "name", kind: .string, required: true, storage: "TEXT"),
      FieldSpec(name: "calendar", column: "calendar", kind: .choice, required: true, storage: "TEXT", values: ["solar", "lunar"]),
      FieldSpec(name: "date", column: "date", kind: .day, required: false, storage: "TEXT"),
      FieldSpec(name: "lunarYear", column: "lunar_year", kind: .integer, required: false, storage: "INTEGER", minimum: 1900, maximum: 2100),
      FieldSpec(name: "lunarMonth", column: "lunar_month", kind: .integer, required: false, storage: "INTEGER", minimum: 1, maximum: 12),
      FieldSpec(name: "lunarDay", column: "lunar_day", kind: .integer, required: false, storage: "INTEGER", minimum: 1, maximum: 30),
      FieldSpec(name: "leap", column: "leap", kind: .boolean, required: false, storage: "INTEGER"),
      FieldSpec(name: "repeat", column: "repeat", kind: .choice, required: true, storage: "TEXT", values: ["once", "weekly", "monthly", "yearly", "custom"]),
      FieldSpec(name: "interval", column: "interval", kind: .integer, required: false, storage: "INTEGER", minimum: 1, maximum: 10000),
      FieldSpec(name: "intervalUnit", column: "interval_unit", kind: .choice, required: true, storage: "TEXT", values: ["day", "week", "month", "year"]),
      FieldSpec(name: "remindDays", column: "remind_days", kind: .integer, required: false, storage: "INTEGER", minimum: 0, maximum: 3650),
      FieldSpec(name: "dismissedDate", column: "dismissed_date", kind: .string, required: false, storage: "TEXT"),
      FieldSpec(name: "note", column: "note", kind: .string, required: false, storage: "TEXT"),
    ]),
  ]
  public static let byType: [String: EntitySpec] = Dictionary(
    uniqueKeysWithValues: all.map { ($0.type, $0) })
}
