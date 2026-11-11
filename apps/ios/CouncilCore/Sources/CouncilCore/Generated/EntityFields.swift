// Generated from packages/contracts/schema.ts by scripts/generate-contracts.ts. Do not edit.
import Foundation

/// A typed view of one entity's payload. `init?(_:)` fails when a required field is missing.
public protocol EntityFields: Sendable, Equatable {
  static var entityType: String { get }
  init?(_ record: Record)
  var data: [String: JSONValue] { get }
}

public struct DepartmentFields: EntityFields {
  public static let entityType = "department"
  public var name: String
  public var features: [String]?
  public init(name: String, features: [String]? = nil) {
    self.name = name
    self.features = features
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.name = name
    self.features = record.data["features"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let features { data["features"] = .array(features.map(JSONValue.string)) }
    return data
  }
}

public struct DomainFields: EntityFields {
  public static let entityType = "domain"
  public var name: String
  public var focused: Bool?
  public var order: Double?
  public var goal: String?
  public init(name: String, focused: Bool? = nil, order: Double? = nil, goal: String? = nil) {
    self.name = name
    self.focused = focused
    self.order = order
    self.goal = goal
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.name = name
    self.focused = record.data["focused"]?.boolValue
    self.order = record.data["order"]?.numberValue
    self.goal = record.data["goal"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let focused { data["focused"] = .bool(focused) }
    if let order { data["order"] = .number(order) }
    if let goal { data["goal"] = .string(goal) }
    return data
  }
}

public struct ActivityFields: EntityFields {
  public static let entityType = "activity"
  public var domainId: String
  public var name: String
  public var archived: Bool?
  public init(domainId: String, name: String, archived: Bool? = nil) {
    self.domainId = domainId
    self.name = name
    self.archived = archived
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let domainId = record.data["domainId"]?.stringValue,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.domainId = domainId
    self.name = name
    self.archived = record.data["archived"]?.boolValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["domainId"] = .string(domainId)
    data["name"] = .string(name)
    if let archived { data["archived"] = .bool(archived) }
    return data
  }
}

public struct ProblemFields: EntityFields {
  public static let entityType = "problem"
  public var domainId: String
  public var activityId: String?
  public var title: String
  public var status: String
  public var focused: Bool?
  public var note: String?
  public init(domainId: String, activityId: String? = nil, title: String, status: String, focused: Bool? = nil, note: String? = nil) {
    self.domainId = domainId
    self.activityId = activityId
    self.title = title
    self.status = status
    self.focused = focused
    self.note = note
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let domainId = record.data["domainId"]?.stringValue,
      let title = record.data["title"]?.stringValue,
      let status = record.data["status"]?.stringValue
    else { return nil }
    self.domainId = domainId
    self.activityId = record.data["activityId"]?.stringValue
    self.title = title
    self.status = status
    self.focused = record.data["focused"]?.boolValue
    self.note = record.data["note"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["domainId"] = .string(domainId)
    if let activityId { data["activityId"] = .string(activityId) }
    data["title"] = .string(title)
    data["status"] = .string(status)
    if let focused { data["focused"] = .bool(focused) }
    if let note { data["note"] = .string(note) }
    return data
  }
}

public struct SolutionFields: EntityFields {
  public static let entityType = "solution"
  public var problemId: String
  public var parentId: String?
  public var title: String
  public var status: String
  public var reason: String?
  public init(problemId: String, parentId: String? = nil, title: String, status: String, reason: String? = nil) {
    self.problemId = problemId
    self.parentId = parentId
    self.title = title
    self.status = status
    self.reason = reason
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let problemId = record.data["problemId"]?.stringValue,
      let title = record.data["title"]?.stringValue,
      let status = record.data["status"]?.stringValue
    else { return nil }
    self.problemId = problemId
    self.parentId = record.data["parentId"]?.stringValue
    self.title = title
    self.status = status
    self.reason = record.data["reason"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["problemId"] = .string(problemId)
    if let parentId { data["parentId"] = .string(parentId) }
    data["title"] = .string(title)
    data["status"] = .string(status)
    if let reason { data["reason"] = .string(reason) }
    return data
  }
}

public struct SessionFields: EntityFields {
  public static let entityType = "session"
  public var domainId: String
  public var activityId: String?
  public var problemId: String?
  public var solutionId: String?
  public var title: String
  public var day: String
  public var startedAt: String?
  public var endedAt: String?
  public var elapsedSeconds: Double?
  public var runningSince: String?
  public var status: String
  public var note: String?
  public var manual: Bool?
  public var segments: [String]?
  public init(domainId: String, activityId: String? = nil, problemId: String? = nil, solutionId: String? = nil, title: String, day: String, startedAt: String? = nil, endedAt: String? = nil, elapsedSeconds: Double? = nil, runningSince: String? = nil, status: String, note: String? = nil, manual: Bool? = nil, segments: [String]? = nil) {
    self.domainId = domainId
    self.activityId = activityId
    self.problemId = problemId
    self.solutionId = solutionId
    self.title = title
    self.day = day
    self.startedAt = startedAt
    self.endedAt = endedAt
    self.elapsedSeconds = elapsedSeconds
    self.runningSince = runningSince
    self.status = status
    self.note = note
    self.manual = manual
    self.segments = segments
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let domainId = record.data["domainId"]?.stringValue,
      let title = record.data["title"]?.stringValue,
      let day = record.data["day"]?.stringValue,
      let status = record.data["status"]?.stringValue
    else { return nil }
    self.domainId = domainId
    self.activityId = record.data["activityId"]?.stringValue
    self.problemId = record.data["problemId"]?.stringValue
    self.solutionId = record.data["solutionId"]?.stringValue
    self.title = title
    self.day = day
    self.startedAt = record.data["startedAt"]?.stringValue
    self.endedAt = record.data["endedAt"]?.stringValue
    self.elapsedSeconds = record.data["elapsedSeconds"]?.numberValue
    self.runningSince = record.data["runningSince"]?.stringValue
    self.status = status
    self.note = record.data["note"]?.stringValue
    self.manual = record.data["manual"]?.boolValue
    self.segments = record.data["segments"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["domainId"] = .string(domainId)
    if let activityId { data["activityId"] = .string(activityId) }
    if let problemId { data["problemId"] = .string(problemId) }
    if let solutionId { data["solutionId"] = .string(solutionId) }
    data["title"] = .string(title)
    data["day"] = .string(day)
    if let startedAt { data["startedAt"] = .string(startedAt) }
    if let endedAt { data["endedAt"] = .string(endedAt) }
    if let elapsedSeconds { data["elapsedSeconds"] = .number(elapsedSeconds) }
    if let runningSince { data["runningSince"] = .string(runningSince) }
    data["status"] = .string(status)
    if let note { data["note"] = .string(note) }
    if let manual { data["manual"] = .bool(manual) }
    if let segments { data["segments"] = .array(segments.map(JSONValue.string)) }
    return data
  }
}

public struct ProgressFields: EntityFields {
  public static let entityType = "progress"
  public var domainId: String
  public var activityId: String?
  public var problemId: String?
  public var solutionId: String?
  public var day: String
  public var body: String
  public init(domainId: String, activityId: String? = nil, problemId: String? = nil, solutionId: String? = nil, day: String, body: String) {
    self.domainId = domainId
    self.activityId = activityId
    self.problemId = problemId
    self.solutionId = solutionId
    self.day = day
    self.body = body
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let domainId = record.data["domainId"]?.stringValue,
      let day = record.data["day"]?.stringValue,
      let body = record.data["body"]?.stringValue
    else { return nil }
    self.domainId = domainId
    self.activityId = record.data["activityId"]?.stringValue
    self.problemId = record.data["problemId"]?.stringValue
    self.solutionId = record.data["solutionId"]?.stringValue
    self.day = day
    self.body = body
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["domainId"] = .string(domainId)
    if let activityId { data["activityId"] = .string(activityId) }
    if let problemId { data["problemId"] = .string(problemId) }
    if let solutionId { data["solutionId"] = .string(solutionId) }
    data["day"] = .string(day)
    data["body"] = .string(body)
    return data
  }
}

public struct TaskFields: EntityFields {
  public static let entityType = "task"
  public var title: String
  public var status: String
  public var scheduleKind: String
  public var scheduleDate: String?
  public var scheduleStart: String?
  public var scheduleEnd: String?
  public var createdAt: String?
  public var completedAt: String?
  public init(title: String, status: String, scheduleKind: String, scheduleDate: String? = nil, scheduleStart: String? = nil, scheduleEnd: String? = nil, createdAt: String? = nil, completedAt: String? = nil) {
    self.title = title
    self.status = status
    self.scheduleKind = scheduleKind
    self.scheduleDate = scheduleDate
    self.scheduleStart = scheduleStart
    self.scheduleEnd = scheduleEnd
    self.createdAt = createdAt
    self.completedAt = completedAt
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let title = record.data["title"]?.stringValue,
      let status = record.data["status"]?.stringValue,
      let scheduleKind = record.data["scheduleKind"]?.stringValue
    else { return nil }
    self.title = title
    self.status = status
    self.scheduleKind = scheduleKind
    self.scheduleDate = record.data["scheduleDate"]?.stringValue
    self.scheduleStart = record.data["scheduleStart"]?.stringValue
    self.scheduleEnd = record.data["scheduleEnd"]?.stringValue
    self.createdAt = record.data["createdAt"]?.stringValue
    self.completedAt = record.data["completedAt"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["title"] = .string(title)
    data["status"] = .string(status)
    data["scheduleKind"] = .string(scheduleKind)
    if let scheduleDate { data["scheduleDate"] = .string(scheduleDate) }
    if let scheduleStart { data["scheduleStart"] = .string(scheduleStart) }
    if let scheduleEnd { data["scheduleEnd"] = .string(scheduleEnd) }
    if let createdAt { data["createdAt"] = .string(createdAt) }
    if let completedAt { data["completedAt"] = .string(completedAt) }
    return data
  }
}

public struct ChecklistFields: EntityFields {
  public static let entityType = "checklist"
  public var name: String
  public var items: [String]?
  public init(name: String, items: [String]? = nil) {
    self.name = name
    self.items = items
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.name = name
    self.items = record.data["items"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let items { data["items"] = .array(items.map(JSONValue.string)) }
    return data
  }
}

public struct ChecklistRunFields: EntityFields {
  public static let entityType = "checklistRun"
  public var checklistId: String
  public var day: String
  public var checked: [String]?
  public init(checklistId: String, day: String, checked: [String]? = nil) {
    self.checklistId = checklistId
    self.day = day
    self.checked = checked
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let checklistId = record.data["checklistId"]?.stringValue,
      let day = record.data["day"]?.stringValue
    else { return nil }
    self.checklistId = checklistId
    self.day = day
    self.checked = record.data["checked"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["checklistId"] = .string(checklistId)
    data["day"] = .string(day)
    if let checked { data["checked"] = .array(checked.map(JSONValue.string)) }
    return data
  }
}

public struct HabitFields: EntityFields {
  public static let entityType = "habit"
  public var name: String
  public var kind: String
  public var unit: String?
  public var items: [String]?
  public var status: String
  public var showHome: Bool?
  public var order: Double?
  public init(name: String, kind: String, unit: String? = nil, items: [String]? = nil, status: String, showHome: Bool? = nil, order: Double? = nil) {
    self.name = name
    self.kind = kind
    self.unit = unit
    self.items = items
    self.status = status
    self.showHome = showHome
    self.order = order
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue,
      let kind = record.data["kind"]?.stringValue,
      let status = record.data["status"]?.stringValue
    else { return nil }
    self.name = name
    self.kind = kind
    self.unit = record.data["unit"]?.stringValue
    self.items = record.data["items"]?.stringsValue
    self.status = status
    self.showHome = record.data["showHome"]?.boolValue
    self.order = record.data["order"]?.numberValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    data["kind"] = .string(kind)
    if let unit { data["unit"] = .string(unit) }
    if let items { data["items"] = .array(items.map(JSONValue.string)) }
    data["status"] = .string(status)
    if let showHome { data["showHome"] = .bool(showHome) }
    if let order { data["order"] = .number(order) }
    return data
  }
}

public struct HabitRuleFields: EntityFields {
  public static let entityType = "habitRule"
  public var habitId: String
  public var effectiveFrom: String
  public var target: Double?
  public var weekdays: [String]?
  public var kind: String?
  public var unit: String?
  public var items: [String]?
  public init(habitId: String, effectiveFrom: String, target: Double? = nil, weekdays: [String]? = nil, kind: String? = nil, unit: String? = nil, items: [String]? = nil) {
    self.habitId = habitId
    self.effectiveFrom = effectiveFrom
    self.target = target
    self.weekdays = weekdays
    self.kind = kind
    self.unit = unit
    self.items = items
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let habitId = record.data["habitId"]?.stringValue,
      let effectiveFrom = record.data["effectiveFrom"]?.stringValue
    else { return nil }
    self.habitId = habitId
    self.effectiveFrom = effectiveFrom
    self.target = record.data["target"]?.numberValue
    self.weekdays = record.data["weekdays"]?.stringsValue
    self.kind = record.data["kind"]?.stringValue
    self.unit = record.data["unit"]?.stringValue
    self.items = record.data["items"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["habitId"] = .string(habitId)
    data["effectiveFrom"] = .string(effectiveFrom)
    if let target { data["target"] = .number(target) }
    if let weekdays { data["weekdays"] = .array(weekdays.map(JSONValue.string)) }
    if let kind { data["kind"] = .string(kind) }
    if let unit { data["unit"] = .string(unit) }
    if let items { data["items"] = .array(items.map(JSONValue.string)) }
    return data
  }
}

public struct HabitLogFields: EntityFields {
  public static let entityType = "habitLog"
  public var habitId: String
  public var ruleId: String?
  public var day: String
  public var value: Double?
  public var items: [String]?
  public var hidden: Bool?
  public init(habitId: String, ruleId: String? = nil, day: String, value: Double? = nil, items: [String]? = nil, hidden: Bool? = nil) {
    self.habitId = habitId
    self.ruleId = ruleId
    self.day = day
    self.value = value
    self.items = items
    self.hidden = hidden
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let habitId = record.data["habitId"]?.stringValue,
      let day = record.data["day"]?.stringValue
    else { return nil }
    self.habitId = habitId
    self.ruleId = record.data["ruleId"]?.stringValue
    self.day = day
    self.value = record.data["value"]?.numberValue
    self.items = record.data["items"]?.stringsValue
    self.hidden = record.data["hidden"]?.boolValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["habitId"] = .string(habitId)
    if let ruleId { data["ruleId"] = .string(ruleId) }
    data["day"] = .string(day)
    if let value { data["value"] = .number(value) }
    if let items { data["items"] = .array(items.map(JSONValue.string)) }
    if let hidden { data["hidden"] = .bool(hidden) }
    return data
  }
}

public struct BudgetFields: EntityFields {
  public static let entityType = "budget"
  public var month: String
  public var amountMinor: String
  public init(month: String, amountMinor: String) {
    self.month = month
    self.amountMinor = amountMinor
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let month = record.data["month"]?.stringValue,
      let amountMinor = record.data["amountMinor"]?.stringValue
    else { return nil }
    self.month = month
    self.amountMinor = amountMinor
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["month"] = .string(month)
    data["amountMinor"] = .string(amountMinor)
    return data
  }
}

public struct CategoryFields: EntityFields {
  public static let entityType = "category"
  public var name: String
  public var parentId: String?
  public var necessary: Bool?
  public var defaultChildId: String?
  public init(name: String, parentId: String? = nil, necessary: Bool? = nil, defaultChildId: String? = nil) {
    self.name = name
    self.parentId = parentId
    self.necessary = necessary
    self.defaultChildId = defaultChildId
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.name = name
    self.parentId = record.data["parentId"]?.stringValue
    self.necessary = record.data["necessary"]?.boolValue
    self.defaultChildId = record.data["defaultChildId"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let parentId { data["parentId"] = .string(parentId) }
    if let necessary { data["necessary"] = .bool(necessary) }
    if let defaultChildId { data["defaultChildId"] = .string(defaultChildId) }
    return data
  }
}

public struct ExpenseFields: EntityFields {
  public static let entityType = "expense"
  public var title: String
  public var day: String
  public var amountMinor: String
  public var categoryId: String?
  public var subcategoryId: String?
  public var necessary: Bool?
  public var mode: String
  public var startDay: String?
  public var endDay: String?
  public var endedDay: String?
  public var recoveryMinor: String?
  public var recoveryDay: String?
  public var note: String?
  public init(title: String, day: String, amountMinor: String, categoryId: String? = nil, subcategoryId: String? = nil, necessary: Bool? = nil, mode: String, startDay: String? = nil, endDay: String? = nil, endedDay: String? = nil, recoveryMinor: String? = nil, recoveryDay: String? = nil, note: String? = nil) {
    self.title = title
    self.day = day
    self.amountMinor = amountMinor
    self.categoryId = categoryId
    self.subcategoryId = subcategoryId
    self.necessary = necessary
    self.mode = mode
    self.startDay = startDay
    self.endDay = endDay
    self.endedDay = endedDay
    self.recoveryMinor = recoveryMinor
    self.recoveryDay = recoveryDay
    self.note = note
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let title = record.data["title"]?.stringValue,
      let day = record.data["day"]?.stringValue,
      let amountMinor = record.data["amountMinor"]?.stringValue,
      let mode = record.data["mode"]?.stringValue
    else { return nil }
    self.title = title
    self.day = day
    self.amountMinor = amountMinor
    self.categoryId = record.data["categoryId"]?.stringValue
    self.subcategoryId = record.data["subcategoryId"]?.stringValue
    self.necessary = record.data["necessary"]?.boolValue
    self.mode = mode
    self.startDay = record.data["startDay"]?.stringValue
    self.endDay = record.data["endDay"]?.stringValue
    self.endedDay = record.data["endedDay"]?.stringValue
    self.recoveryMinor = record.data["recoveryMinor"]?.stringValue
    self.recoveryDay = record.data["recoveryDay"]?.stringValue
    self.note = record.data["note"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["title"] = .string(title)
    data["day"] = .string(day)
    data["amountMinor"] = .string(amountMinor)
    if let categoryId { data["categoryId"] = .string(categoryId) }
    if let subcategoryId { data["subcategoryId"] = .string(subcategoryId) }
    if let necessary { data["necessary"] = .bool(necessary) }
    data["mode"] = .string(mode)
    if let startDay { data["startDay"] = .string(startDay) }
    if let endDay { data["endDay"] = .string(endDay) }
    if let endedDay { data["endedDay"] = .string(endedDay) }
    if let recoveryMinor { data["recoveryMinor"] = .string(recoveryMinor) }
    if let recoveryDay { data["recoveryDay"] = .string(recoveryDay) }
    if let note { data["note"] = .string(note) }
    return data
  }
}

public struct RecurringExpenseFields: EntityFields {
  public static let entityType = "recurringExpense"
  public var name: String
  public var amountMinor: String
  public var categoryId: String?
  public var active: Bool?
  public init(name: String, amountMinor: String, categoryId: String? = nil, active: Bool? = nil) {
    self.name = name
    self.amountMinor = amountMinor
    self.categoryId = categoryId
    self.active = active
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue,
      let amountMinor = record.data["amountMinor"]?.stringValue
    else { return nil }
    self.name = name
    self.amountMinor = amountMinor
    self.categoryId = record.data["categoryId"]?.stringValue
    self.active = record.data["active"]?.boolValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    data["amountMinor"] = .string(amountMinor)
    if let categoryId { data["categoryId"] = .string(categoryId) }
    if let active { data["active"] = .bool(active) }
    return data
  }
}

public struct WalletFields: EntityFields {
  public static let entityType = "wallet"
  public var name: String
  public var category: String
  public var asset: String?
  public var currency: String
  public var unitPrice: String?
  public var exchangeRate: String?
  public init(name: String, category: String, asset: String? = nil, currency: String, unitPrice: String? = nil, exchangeRate: String? = nil) {
    self.name = name
    self.category = category
    self.asset = asset
    self.currency = currency
    self.unitPrice = unitPrice
    self.exchangeRate = exchangeRate
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue,
      let category = record.data["category"]?.stringValue,
      let currency = record.data["currency"]?.stringValue
    else { return nil }
    self.name = name
    self.category = category
    self.asset = record.data["asset"]?.stringValue
    self.currency = currency
    self.unitPrice = record.data["unitPrice"]?.stringValue
    self.exchangeRate = record.data["exchangeRate"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    data["category"] = .string(category)
    if let asset { data["asset"] = .string(asset) }
    data["currency"] = .string(currency)
    if let unitPrice { data["unitPrice"] = .string(unitPrice) }
    if let exchangeRate { data["exchangeRate"] = .string(exchangeRate) }
    return data
  }
}

public struct AssetFields: EntityFields {
  public static let entityType = "asset"
  public var name: String
  public var symbol: String?
  public var kind: String
  public var quoteId: String?
  public var currency: String?
  public var manualPrice: String?
  public var order: Double?
  public init(name: String, symbol: String? = nil, kind: String, quoteId: String? = nil, currency: String? = nil, manualPrice: String? = nil, order: Double? = nil) {
    self.name = name
    self.symbol = symbol
    self.kind = kind
    self.quoteId = quoteId
    self.currency = currency
    self.manualPrice = manualPrice
    self.order = order
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue,
      let kind = record.data["kind"]?.stringValue
    else { return nil }
    self.name = name
    self.symbol = record.data["symbol"]?.stringValue
    self.kind = kind
    self.quoteId = record.data["quoteId"]?.stringValue
    self.currency = record.data["currency"]?.stringValue
    self.manualPrice = record.data["manualPrice"]?.stringValue
    self.order = record.data["order"]?.numberValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let symbol { data["symbol"] = .string(symbol) }
    data["kind"] = .string(kind)
    if let quoteId { data["quoteId"] = .string(quoteId) }
    if let currency { data["currency"] = .string(currency) }
    if let manualPrice { data["manualPrice"] = .string(manualPrice) }
    if let order { data["order"] = .number(order) }
    return data
  }
}

public struct AssetPriceFields: EntityFields {
  public static let entityType = "assetPrice"
  public var assetId: String
  public var at: String
  public var price: String
  public init(assetId: String, at: String, price: String) {
    self.assetId = assetId
    self.at = at
    self.price = price
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let assetId = record.data["assetId"]?.stringValue,
      let at = record.data["at"]?.stringValue,
      let price = record.data["price"]?.stringValue
    else { return nil }
    self.assetId = assetId
    self.at = at
    self.price = price
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["assetId"] = .string(assetId)
    data["at"] = .string(at)
    data["price"] = .string(price)
    return data
  }
}

public struct WalletEntryFields: EntityFields {
  public static let entityType = "walletEntry"
  public var walletId: String
  public var assetId: String?
  public var mode: String
  public var quantity: String
  public var at: String
  public var reason: String?
  public var unitPrice: String?
  public var exchangeRate: String?
  public init(walletId: String, assetId: String? = nil, mode: String, quantity: String, at: String, reason: String? = nil, unitPrice: String? = nil, exchangeRate: String? = nil) {
    self.walletId = walletId
    self.assetId = assetId
    self.mode = mode
    self.quantity = quantity
    self.at = at
    self.reason = reason
    self.unitPrice = unitPrice
    self.exchangeRate = exchangeRate
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let walletId = record.data["walletId"]?.stringValue,
      let mode = record.data["mode"]?.stringValue,
      let quantity = record.data["quantity"]?.stringValue,
      let at = record.data["at"]?.stringValue
    else { return nil }
    self.walletId = walletId
    self.assetId = record.data["assetId"]?.stringValue
    self.mode = mode
    self.quantity = quantity
    self.at = at
    self.reason = record.data["reason"]?.stringValue
    self.unitPrice = record.data["unitPrice"]?.stringValue
    self.exchangeRate = record.data["exchangeRate"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["walletId"] = .string(walletId)
    if let assetId { data["assetId"] = .string(assetId) }
    data["mode"] = .string(mode)
    data["quantity"] = .string(quantity)
    data["at"] = .string(at)
    if let reason { data["reason"] = .string(reason) }
    if let unitPrice { data["unitPrice"] = .string(unitPrice) }
    if let exchangeRate { data["exchangeRate"] = .string(exchangeRate) }
    return data
  }
}

public struct DocumentFields: EntityFields {
  public static let entityType = "document"
  public var title: String
  public var body: String?
  public var kind: String
  public var day: String?
  public var month: String?
  public var domainId: String?
  public var activityId: String?
  public var source: String?
  public var tags: [String]?
  public init(title: String, body: String? = nil, kind: String, day: String? = nil, month: String? = nil, domainId: String? = nil, activityId: String? = nil, source: String? = nil, tags: [String]? = nil) {
    self.title = title
    self.body = body
    self.kind = kind
    self.day = day
    self.month = month
    self.domainId = domainId
    self.activityId = activityId
    self.source = source
    self.tags = tags
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let title = record.data["title"]?.stringValue,
      let kind = record.data["kind"]?.stringValue
    else { return nil }
    self.title = title
    self.body = record.data["body"]?.stringValue
    self.kind = kind
    self.day = record.data["day"]?.stringValue
    self.month = record.data["month"]?.stringValue
    self.domainId = record.data["domainId"]?.stringValue
    self.activityId = record.data["activityId"]?.stringValue
    self.source = record.data["source"]?.stringValue
    self.tags = record.data["tags"]?.stringsValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["title"] = .string(title)
    if let body { data["body"] = .string(body) }
    data["kind"] = .string(kind)
    if let day { data["day"] = .string(day) }
    if let month { data["month"] = .string(month) }
    if let domainId { data["domainId"] = .string(domainId) }
    if let activityId { data["activityId"] = .string(activityId) }
    if let source { data["source"] = .string(source) }
    if let tags { data["tags"] = .array(tags.map(JSONValue.string)) }
    return data
  }
}

public struct JournalFields: EntityFields {
  public static let entityType = "journal"
  public var kind: String
  public var day: String
  public var body: String
  public var complete: Bool?
  public init(kind: String, day: String, body: String, complete: Bool? = nil) {
    self.kind = kind
    self.day = day
    self.body = body
    self.complete = complete
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let kind = record.data["kind"]?.stringValue,
      let day = record.data["day"]?.stringValue,
      let body = record.data["body"]?.stringValue
    else { return nil }
    self.kind = kind
    self.day = day
    self.body = body
    self.complete = record.data["complete"]?.boolValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["kind"] = .string(kind)
    data["day"] = .string(day)
    data["body"] = .string(body)
    if let complete { data["complete"] = .bool(complete) }
    return data
  }
}

public struct IdeaFields: EntityFields {
  public static let entityType = "idea"
  public var body: String
  public var day: String
  public var status: String
  public init(body: String, day: String, status: String) {
    self.body = body
    self.day = day
    self.status = status
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let body = record.data["body"]?.stringValue,
      let day = record.data["day"]?.stringValue,
      let status = record.data["status"]?.stringValue
    else { return nil }
    self.body = body
    self.day = day
    self.status = status
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["body"] = .string(body)
    data["day"] = .string(day)
    data["status"] = .string(status)
    return data
  }
}

public struct MetricFields: EntityFields {
  public static let entityType = "metric"
  public var name: String
  public var unit: String?
  public var minimum: Double?
  public var maximum: Double?
  public init(name: String, unit: String? = nil, minimum: Double? = nil, maximum: Double? = nil) {
    self.name = name
    self.unit = unit
    self.minimum = minimum
    self.maximum = maximum
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue
    else { return nil }
    self.name = name
    self.unit = record.data["unit"]?.stringValue
    self.minimum = record.data["minimum"]?.numberValue
    self.maximum = record.data["maximum"]?.numberValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    if let unit { data["unit"] = .string(unit) }
    if let minimum { data["minimum"] = .number(minimum) }
    if let maximum { data["maximum"] = .number(maximum) }
    return data
  }
}

public struct MetricLogFields: EntityFields {
  public static let entityType = "metricLog"
  public var metricId: String
  public var day: String
  public var value: Double?
  public var note: String?
  public init(metricId: String, day: String, value: Double? = nil, note: String? = nil) {
    self.metricId = metricId
    self.day = day
    self.value = value
    self.note = note
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let metricId = record.data["metricId"]?.stringValue,
      let day = record.data["day"]?.stringValue
    else { return nil }
    self.metricId = metricId
    self.day = day
    self.value = record.data["value"]?.numberValue
    self.note = record.data["note"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["metricId"] = .string(metricId)
    data["day"] = .string(day)
    if let value { data["value"] = .number(value) }
    if let note { data["note"] = .string(note) }
    return data
  }
}

public struct ImportantDayFields: EntityFields {
  public static let entityType = "importantDay"
  public var name: String
  public var calendar: String
  public var date: String?
  public var lunarYear: Int?
  public var lunarMonth: Int?
  public var lunarDay: Int?
  public var leap: Bool?
  public var `repeat`: String
  public var interval: Int?
  public var intervalUnit: String
  public var remindDays: Int?
  public var dismissedDate: String?
  public var note: String?
  public init(name: String, calendar: String, date: String? = nil, lunarYear: Int? = nil, lunarMonth: Int? = nil, lunarDay: Int? = nil, leap: Bool? = nil, `repeat`: String, interval: Int? = nil, intervalUnit: String, remindDays: Int? = nil, dismissedDate: String? = nil, note: String? = nil) {
    self.name = name
    self.calendar = calendar
    self.date = date
    self.lunarYear = lunarYear
    self.lunarMonth = lunarMonth
    self.lunarDay = lunarDay
    self.leap = leap
    self.repeat = `repeat`
    self.interval = interval
    self.intervalUnit = intervalUnit
    self.remindDays = remindDays
    self.dismissedDate = dismissedDate
    self.note = note
  }
  public init?(_ record: Record) {
    guard record.type == Self.entityType,
      let name = record.data["name"]?.stringValue,
      let calendar = record.data["calendar"]?.stringValue,
      let `repeat` = record.data["repeat"]?.stringValue,
      let intervalUnit = record.data["intervalUnit"]?.stringValue
    else { return nil }
    self.name = name
    self.calendar = calendar
    self.date = record.data["date"]?.stringValue
    self.lunarYear = record.data["lunarYear"]?.numberValue.map { Int($0) }
    self.lunarMonth = record.data["lunarMonth"]?.numberValue.map { Int($0) }
    self.lunarDay = record.data["lunarDay"]?.numberValue.map { Int($0) }
    self.leap = record.data["leap"]?.boolValue
    self.repeat = `repeat`
    self.interval = record.data["interval"]?.numberValue.map { Int($0) }
    self.intervalUnit = intervalUnit
    self.remindDays = record.data["remindDays"]?.numberValue.map { Int($0) }
    self.dismissedDate = record.data["dismissedDate"]?.stringValue
    self.note = record.data["note"]?.stringValue
  }
  public var data: [String: JSONValue] {
    var data: [String: JSONValue] = [:]
    data["name"] = .string(name)
    data["calendar"] = .string(calendar)
    if let date { data["date"] = .string(date) }
    if let lunarYear { data["lunarYear"] = .number(Double(lunarYear)) }
    if let lunarMonth { data["lunarMonth"] = .number(Double(lunarMonth)) }
    if let lunarDay { data["lunarDay"] = .number(Double(lunarDay)) }
    if let leap { data["leap"] = .bool(leap) }
    data["repeat"] = .string(`repeat`)
    if let interval { data["interval"] = .number(Double(interval)) }
    data["intervalUnit"] = .string(intervalUnit)
    if let remindDays { data["remindDays"] = .number(Double(remindDays)) }
    if let dismissedDate { data["dismissedDate"] = .string(dismissedDate) }
    if let note { data["note"] = .string(note) }
    return data
  }
}
