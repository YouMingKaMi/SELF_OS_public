import CouncilCore
import SwiftUI

extension View {
  /// Grouped list on black: native swipe actions, cards as sections.
  func studioList() -> some View {
    listStyle(.insetGrouped).scrollContentBackground(.hidden).background(Ink.bg)
      .listSectionSpacing(14).environment(\.defaultMinListRowHeight, 44)
      .scrollDismissesKeyboard(.interactively)
  }
  func cardRow() -> some View {
    listRowBackground(Ink.card).listRowSeparatorTint(Ink.line)
      .listRowInsets(EdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 16))
  }
}

enum JournalKind: String {
  case chronicle, raw, idea
  var title: String {
    switch self {
    case .chronicle: "编年史"
    case .raw: "未加工原料"
    case .idea: "想法暂存"
    }
  }
  var unit: String {
    switch self {
    case .chronicle: "件事"
    case .raw: "条原料"
    case .idea: "个想法"
    }
  }
  var placeholder: String {
    switch self {
    case .chronicle: "今天发生了什么？"
    case .raw: "粘贴原文、链接或语音文字…"
    case .idea: "一个想法…"
    }
  }
  var type: String { self == .idea ? "idea" : "journal" }
}

struct JournalScreen: View {
  @Environment(Studio.self) private var studio
  let kind: JournalKind
  @State private var day = Day.today
  @State private var month = String(Day.today.prefix(7))
  @State private var draft = ""
  @State private var status = "pending"
  @State private var editing: Record?
  var rows: [Record] {
    studio.all(kind.type).filter { kind == .idea || $0.text("kind") == kind.rawValue }
  }
  var dayRows: [Record] {
    rows.filter { $0.text("day") == day }.sorted { $0.updatedAt < $1.updatedAt }
  }
  var monthRows: [Record] {
    rows.filter {
      $0.text("day").hasPrefix(month) && (kind != .idea || $0.text("status") == status)
    }
  }
  var body: some View {
    List {
      if kind == .idea {
        Section {
          ChipBar(
            options: [("pending", "待实现"), ("completed", "已完成"), ("discarded", "已废弃")],
            selection: $status
          ).listRowBackground(Color.clear).listRowInsets(EdgeInsets())
        }
      } else {
        Section {
          DayStrip(day: $day).listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets(top: 0, leading: 6, bottom: 0, trailing: 0))
        }
        Section {
          ForEach(dayRows) { row in line(row) }
          if dayRows.isEmpty {
            Text(day == Day.today ? "这一天还空着，从下面写第一件。" : "这一天没有记录")
              .font(Ink.meta).foregroundStyle(Ink.text3).cardRow()
          }
        } header: {
          header(day == Day.today ? "今天" : Day.short(day), "\(dayRows.count) \(kind.unit)")
        }
      }
      Section {
        MonthBar(month: $month).listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets(top: 4, leading: 6, bottom: 0, trailing: 6))
      }
      let days = kind == .idea ? [] : Array(Set(monthRows.map { $0.text("day") })).sorted(by: >)
      if kind == .idea && !monthRows.isEmpty {
        Section {
          ForEach(monthRows.sorted { $0.text("day") == $1.text("day") ? $0.updatedAt > $1.updatedAt : $0.text("day") > $1.text("day") }) {
            line($0)
          }
        } header: {
          header("\(monthRows.count) \(kind.unit)", "左滑完成 · 右滑废弃")
        }
      }
      ForEach(days, id: \.self) { date in
        Section {
          ForEach(monthRows.filter { $0.text("day") == date }.sorted { $0.updatedAt < $1.updatedAt }) {
            line($0)
          }
        } header: {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(String(Int(date.suffix(2)) ?? 0)).font(.system(size: 22, weight: .semibold, design: .rounded))
              .foregroundStyle(Ink.text)
            Text("周" + Day.weekday(date)).font(Ink.meta).foregroundStyle(Ink.text3)
            Spacer()
            if kind != .idea && date != day {
              Button("补记") { withAnimation(.snappy) { day = date } }.font(Ink.meta)
                .foregroundStyle(Ink.text2)
            }
          }.textCase(nil).padding(.leading, -4)
        }
      }
      if monthRows.isEmpty {
        Section {
          Text("这个月还没有记录").font(Ink.meta).foregroundStyle(Ink.text3).cardRow()
        }
      }
    }
    .studioList()
    .animation(.snappy, value: rows.count)
    .safeAreaInset(edge: .bottom) {
      Composer(text: $draft, placeholder: kind.placeholder, multiline: kind == .raw) { save() }
    }
    .toolbar(.hidden, for: .tabBar)
    .studioScreen(kind.title)
    .sheet(item: $editing) { row in TextEditSheet(record: row) }
  }
  func header(_ title: String, _ meta: String) -> some View {
    HStack {
      Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(Ink.text2)
      Spacer()
      Text(meta).font(Ink.meta).foregroundStyle(Ink.text3)
    }.textCase(nil)
  }
  @ViewBuilder func line(_ row: Record) -> some View {
    let queued = studio.pending.last { $0.entityId == row.id }?.state == "queued"
    HStack(alignment: .top, spacing: 10) {
      if kind == .idea {
        Image(systemName: row.text("status") == "completed" ? "checkmark.circle.fill" : "circle")
          .foregroundStyle(row.text("status") == "pending" ? Ink.text3 : Ink.text2)
          .font(.system(size: 17)).padding(.top, 1)
      }
      Text(row.text("body"))
        .font(kind == .raw ? .system(size: 14, design: .monospaced) : Ink.body)
        .foregroundStyle(row.text("status") == "discarded" ? Ink.text3 : Ink.text)
        .strikethrough(row.text("status") == "completed", color: Ink.text3)
        .lineSpacing(3).frame(maxWidth: .infinity, alignment: .leading)
      if kind == .idea {
        Text(Day.short(row.text("day"))).font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
          .padding(.top, 2)
      }
      if queued {
        Image(systemName: "icloud.and.arrow.up").font(.system(size: 11)).foregroundStyle(Ink.text3)
      }
    }
    .contentShape(Rectangle())
    .onTapGesture { editing = row }
    .cardRow()
    .swipeActions(edge: .trailing) {
      Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(row) } }
      if kind == .idea {
        Button("废弃", systemImage: "xmark") {
          Task {
            await studio.update(
              row, ["status": .string(row.text("status") == "discarded" ? "pending" : "discarded")])
          }
        }.tint(Color(white: 0.3))
      }
    }
    .swipeActions(edge: .leading) {
      if kind == .idea {
        Button(row.text("status") == "completed" ? "恢复" : "完成", systemImage: "checkmark") {
          Task {
            await studio.update(
              row, ["status": .string(row.text("status") == "completed" ? "pending" : "completed")])
          }
        }.tint(Ink.live)
      }
    }
    .contextMenu {
      Button("编辑", systemImage: "pencil") { editing = row }
      Button("拷贝", systemImage: "doc.on.doc") { UIPasteboard.general.string = row.text("body") }
      if queued, let op = studio.pending.last(where: { $0.entityId == row.id }) {
        Button("撤销待发送", systemImage: "arrow.uturn.backward") { Task { await studio.undo(op) } }
      }
      Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(row) } }
    }
  }
  func save() {
    let text = draft
    draft = ""
    var data: [String: JSONValue] = ["body": .string(text), "day": .string(day)]
    if kind == .idea {
      data["status"] = .string("pending")
      data["day"] = .string(Day.today)
    } else {
      data["kind"] = .string(kind.rawValue)
      data["complete"] = .bool(false)
    }
    Task { await studio.save(kind.type, data) }
  }
}

/// Edit any record's body text.
struct TextEditSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record
  @State private var text = ""
  var body: some View {
    NavigationStack {
      TextEditor(text: $text).font(Ink.body).scrollContentBackground(.hidden)
        .padding(.horizontal, 14).background(Ink.card)
        .navigationTitle("编辑").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button("保存") {
              Task {
                await studio.update(record, ["body": .string(text)])
                dismiss()
              }
            }.fontWeight(.semibold).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
    }.studioSheet().presentationDetents([.medium, .large])
      .onAppear { text = record.text("body") }
  }
}

/// Capture from anywhere: one field, one button, done.
struct QuickNoteSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let kind: JournalKind
  @State private var text = ""
  @FocusState private var focused: Bool
  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        TextField(kind.placeholder, text: $text, axis: .vertical).font(.system(size: 18))
          .lineLimit(3...12).focused($focused)
        Spacer()
      }.padding(20).background(Ink.card)
        .navigationTitle(kind.title).navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button("保存") {
              var data: [String: JSONValue] = ["body": .string(text), "day": .string(Day.today)]
              if kind == .idea {
                data["status"] = .string("pending")
              } else {
                data["kind"] = .string(kind.rawValue)
                data["complete"] = .bool(false)
              }
              Task {
                await studio.save(kind.type, data)
                dismiss()
              }
            }.fontWeight(.semibold).disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
    }.studioSheet().presentationDetents([.height(300), .large]).onAppear { focused = true }
  }
}
