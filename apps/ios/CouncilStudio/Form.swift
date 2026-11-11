import CouncilCore
import SwiftUI

/// A request to create or edit any entity with the schema-driven form.
struct EntityForm: Identifiable {
  let id = UUID()
  let type: String
  var record: Record? = nil
  /// Context values (e.g. the parent problem). Fields given here are not shown.
  var defaults: [String: JSONValue] = [:]
  /// Optional explicit field list and order.
  var fields: [String]? = nil
}

enum FieldWords {
  static let labels: [String: String] = [
    "name": "名称", "title": "标题", "body": "正文", "day": "日期", "month": "月份", "kind": "类型",
    "status": "状态", "domainId": "领域", "activityId": "子领域", "problemId": "问题", "solutionId": "方案",
    "parentId": "上级方案", "focused": "首页专注", "archived": "归档", "habitId": "习惯", "unit": "单位",
    "items": "项目（每行一个）", "value": "数值", "amountMinor": "金额（元）", "necessary": "必要支出",
    "categoryId": "用途", "subcategoryId": "细分", "mode": "方式", "startDay": "开始使用", "endDay": "预计到期",
    "endedDay": "实际结束", "recoveryMinor": "回收金额（元）", "recoveryDay": "回收日期", "note": "备注",
    "reason": "发现 / 废弃原因", "currency": "币种", "asset": "资产", "unitPrice": "单价", "exchangeRate": "汇率",
    "walletId": "账户", "quantity": "数量", "at": "时间", "minimum": "最小值", "maximum": "最大值",
    "calendar": "历法", "date": "日期", "repeat": "重复", "interval": "间隔", "intervalUnit": "间隔单位",
    "remindDays": "提前提醒（天）", "active": "启用", "checklistId": "清单", "source": "来源",
    "defaultChildId": "默认细分", "features": "功能", "symbol": "代码",
    "manualPrice": "备用价格（人民币，行情不可用时）", "quoteId": "行情来源", "assetId": "标的",
  ]
  static func label(_ key: String) -> String { labels[key] ?? key }
  static let hidden: Set<String> = ["order", "segments", "runningSince", "elapsedSeconds", "startedAt", "endedAt"]
  static let long: Set<String> = ["body", "note", "reason"]
}

struct EntityFormSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let form: EntityForm
  @State private var data: [String: JSONValue] = [:]
  @State private var texts: [String: String] = [:]
  @State private var confirmDelete = false
  var spec: EntitySpec? { EntitySchema.byType[form.type] }
  var shown: [FieldSpec] {
    guard let spec else { return [] }
    let names = form.fields ?? spec.fields.map(\.name)
    return names.compactMap { spec.field($0) }.filter {
      !FieldWords.hidden.contains($0.name) && (form.record != nil || form.defaults[$0.name] == nil)
        && !(form.record != nil && $0.kind == .ref && $0.required)
    }
  }
  var body: some View {
    NavigationStack {
      Form {
        Section {
          ForEach(shown, id: \.name) { field in control(field) }
        }.listRowBackground(Ink.raised)
        if let record = form.record {
          Section {
            Button("移入回收站", role: .destructive) { confirmDelete = true }
          }.listRowBackground(Ink.raised)
            .confirmationDialog("移入回收站？", isPresented: $confirmDelete) {
              Button("移入回收站", role: .destructive) {
                Task {
                  await studio.remove(record)
                  dismiss()
                }
              }
            }
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle((form.record == nil ? "新" : "编辑") + typeName).navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }.fontWeight(.semibold).disabled(!valid)
        }
      }
    }.studioSheet().presentationDetents([.medium, .large])
      .onAppear(perform: load)
  }
  var typeName: String {
    [
      "domain": "领域", "activity": "子领域", "problem": "问题", "solution": "方案", "metric": "指标",
      "checklist": "清单", "category": "分类", "recurringExpense": "固定支出", "wallet": "账户",
      "department": "部门", "budget": "预算", "importantDay": "日子", "asset": "标的",
    ][form.type] ?? "记录"
  }
  var valid: Bool {
    shown.allSatisfy { field in
      guard field.required else { return true }
      switch field.kind {
      case .string, .money, .decimal, .month: return !(texts[field.name] ?? data[field.name]?.text ?? "").trimmingCharacters(in: .whitespaces).isEmpty
      default: return data[field.name] != nil
      }
    }
  }
  func load() {
    data = form.defaults.merging(form.record?.data ?? [:]) { _, record in record }
    for (key, value) in data where value == .null { data.removeValue(forKey: key) }
    for field in spec?.fields ?? [] {
      switch field.kind {
      case .string, .month, .decimal: texts[field.name] = data[field.name]?.text ?? ""
      case .money: texts[field.name] = data[field.name].map { Money.yuan($0.text) } ?? ""
      case .integer, .number:
        texts[field.name] = data[field.name].map { v in
          v.double == v.double.rounded() ? String(Int(v.double)) : String(v.double)
        } ?? ""
      case .strings: texts[field.name] = (data[field.name]?.strings ?? []).joined(separator: "\n")
      default: break
      }
    }
  }
  @ViewBuilder func control(_ field: FieldSpec) -> some View {
    let label = FieldWords.label(field.name)
    switch field.kind {
    case .string, .month:
      TextField(label, text: text(field.name), axis: FieldWords.long.contains(field.name) ? .vertical : .horizontal)
        .lineLimit(FieldWords.long.contains(field.name) ? 3...8 : 1...1)
    case .money, .decimal, .integer, .number:
      HStack {
        Text(label).foregroundStyle(Ink.text2)
        TextField(field.required ? "必填" : "可留空", text: text(field.name))
          .keyboardType(field.kind == .integer ? .numberPad : .decimalPad).multilineTextAlignment(.trailing)
      }
    case .strings:
      TextField(label, text: text(field.name), axis: .vertical).lineLimit(2...8)
    case .boolean:
      Toggle(label, isOn: Binding(get: { data[field.name]?.boolean ?? false }, set: { data[field.name] = .bool($0) }))
    case .choice:
      Picker(label, selection: Binding(get: { data[field.name]?.text ?? "" }, set: { data[field.name] = $0.isEmpty ? nil : .string($0) })) {
        if !field.required { Text("不设置").tag("") }
        ForEach(field.values, id: \.self) { Text(Words.of($0)).tag($0) }
      }
    case .ref:
      Picker(label, selection: Binding(get: { data[field.name]?.text ?? "" }, set: { data[field.name] = $0.isEmpty ? nil : .string($0) })) {
        if !field.required { Text("无").tag("") }
        ForEach(options(for: field), id: \.id) { Text($0.title).tag($0.id) }
      }
    case .day:
      if field.required || data[field.name] != nil {
        HStack {
          DatePicker(label, selection: dateBinding(field.name), displayedComponents: .date)
          if !field.required {
            Button {
              data[field.name] = nil
            } label: {
              Image(systemName: "xmark.circle.fill").foregroundStyle(Ink.text3)
            }.buttonStyle(.plain)
          }
        }
      } else {
        Button("设置" + label) { data[field.name] = .string(Day.today) }
      }
    case .timestamp:
      DatePicker(label, selection: Binding(
        get: { Clock.parse(data[field.name]?.text ?? "") ?? Date() },
        set: { data[field.name] = .string(ISO8601DateFormatter().string(from: $0)) }))
    }
  }
  func options(for field: FieldSpec) -> [Record] {
    let all = studio.all(field.target ?? "")
    // Keep choices on the same branch as the context: same domain, same problem, top-level categories.
    switch field.name {
    case "activityId": return all.filter { $0.text("domainId") == (data["domainId"]?.text ?? $0.text("domainId")) }
    case "parentId" where form.type == "solution":
      return all.filter { $0.text("problemId") == data["problemId"]?.text && $0.id != form.record?.id }
    case "parentId" where form.type == "category": return all.filter { $0.text("parentId").isEmpty && $0.id != form.record?.id }
    case "defaultChildId": return all.filter { $0.text("parentId") == form.record?.id }
    default: return all
    }
  }
  func text(_ key: String) -> Binding<String> {
    Binding(get: { texts[key] ?? "" }, set: { texts[key] = $0 })
  }
  func dateBinding(_ key: String) -> Binding<Date> {
    Binding(get: { CalendarDays.date(data[key]?.text ?? "") ?? Date() }, set: { data[key] = .string(CalendarDays.string($0)) })
  }
  func save() {
    var out = data
    for field in spec?.fields ?? [] {
      guard let raw = texts[field.name] else { continue }
      let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
      switch field.kind {
      case .string: out[field.name] = value.isEmpty && !field.required ? nil : .string(raw)
      case .month, .decimal: out[field.name] = value.isEmpty ? nil : .string(value)
      case .money: out[field.name] = value.isEmpty ? nil : Money.minor(value).map(JSONValue.string)
      case .integer, .number: out[field.name] = Double(value).map(JSONValue.number)
      case .strings:
        out[field.name] = .array(raw.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.map(JSONValue.string))
      default: break
      }
    }
    Task {
      if await studio.save(form.type, out, id: form.record?.id) != nil { dismiss() }
    }
  }
}
