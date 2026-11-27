import CouncilCore
import SwiftUI
import UIKit

struct JournalTransferTarget: Identifiable, Hashable {
  let id: String
  let kind: JournalKind
  let day: String
}

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
  var initialFocus: JournalTransferTarget? = nil
  @State private var day = Day.today
  @State private var month = String(Day.today.prefix(7))
  @State private var draft = ""
  @State private var status = "pending"
  @State private var editing: Record?
  @State private var transferring: Record?
  @State private var transferBanner: JournalTransferTarget?
  @State private var openDestination: JournalTransferTarget?
  @State private var highlightedId: String?
  @State private var appliedInitialFocus = false
  var canTransfer: Bool { kind == .idea || kind == .raw }
  var targetKind: JournalKind { kind == .idea ? .raw : .idea }
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
    ScrollViewReader { proxy in
      List {
        if let banner = transferBanner {
          Section {
            HStack(spacing: 10) {
              VStack(alignment: .leading, spacing: 2) {
                Text("已移至\(banner.kind.title)")
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundStyle(Ink.text)
                Text("保留原日期 \(banner.day)")
                  .font(Ink.meta)
                  .foregroundStyle(Ink.text3)
              }
              Spacer()
              Button("去查看") {
                openDestination = banner
                transferBanner = nil
              }
              .buttonStyle(.chip)
              Button {
                transferBanner = nil
              } label: {
                Image(systemName: "xmark")
                  .font(.system(size: 11, weight: .semibold))
                  .foregroundStyle(Ink.text3)
              }
              .buttonStyle(.plain)
            }
            .cardRow()
          }
        }
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
            header("\(monthRows.count) \(kind.unit)", "右滑完成 · 左滑移入原料 / 废弃")
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
              if kind != .idea && date == day {
                Text("编辑中").font(Ink.meta).foregroundStyle(Ink.text3)
              }
            }.textCase(nil).padding(.leading, -4)
              // Tap a day's header to write into that day above.
              .contentShape(Rectangle())
              .onTapGesture { if kind != .idea { withAnimation(.snappy) { day = date } } }
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
      .onAppear {
        if let focus = initialFocus, !appliedInitialFocus {
          appliedInitialFocus = true
          day = focus.day
          month = String(focus.day.prefix(7))
          if kind == .idea { status = "pending" }
          highlightedId = focus.id
          Task {
            try? await Task.sleep(for: .milliseconds(250))
            withAnimation(.snappy) { proxy.scrollTo(focus.id, anchor: .center) }
            try? await Task.sleep(for: .seconds(3))
            if highlightedId == focus.id { highlightedId = nil }
          }
        }
      }
    }
    .safeAreaInset(edge: .bottom) {
      Composer(text: $draft, placeholder: kind.placeholder, multiline: kind == .raw) { save() }
    }
    .toolbar(.hidden, for: .tabBar)
    .studioScreen(kind.title)
    .toolbar {
      if kind == .chronicle {
        ToolbarItem(placement: .topBarTrailing) {
          NavigationLink("回忆录") { MemoirScreen() }
            .font(.system(size: 14))
        }
      }
    }
    .navigationDestination(item: $openDestination) { dest in
      JournalScreen(kind: dest.kind, initialFocus: dest)
    }
    .sheet(item: $editing) { row in
      TextEditSheet(
        record: row,
        onTransfer: canTransfer ? {
          editing = nil
          transferring = row
        } : nil
      )
    }
    .sheet(item: $transferring) { row in
      JournalTransferSheet(source: row, targetKind: targetKind) { created in
        transferBanner = created
      }
    }
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
    .id(row.id)
    .listRowBackground(highlightedId == row.id ? Ink.raised : Ink.card)
    .listRowSeparatorTint(Ink.line)
    .listRowInsets(EdgeInsets(top: 10, leading: 18, bottom: 10, trailing: 16))
    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
      Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(row) } }
      if kind == .idea {
        Button("废弃", systemImage: "xmark") {
          Task {
            await studio.update(
              row, ["status": .string(row.text("status") == "discarded" ? "pending" : "discarded")])
          }
        }.tint(Color(white: 0.28))
      }
      if canTransfer {
        Button(
          targetKind == .raw ? "移入原料" : "移入想法",
          systemImage: "arrow.left.arrow.right"
        ) {
          transferring = row
        }.tint(Color(white: 0.44))
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
      if canTransfer {
        Button(
          targetKind == .raw ? "移至未加工原料" : "移至想法暂存",
          systemImage: "arrow.left.arrow.right"
        ) {
          transferring = row
        }
      }
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
  var onTransfer: (() -> Void)? = nil
  @State private var text = ""
  var transferLabel: String {
    record.type == "idea" ? "移至原料" : "移至想法"
  }
  var body: some View {
    NavigationStack {
      TextEditor(text: $text).font(Ink.body).scrollContentBackground(.hidden)
        .padding(.horizontal, 14).background(Ink.card)
        .navigationTitle("编辑").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
          if let onTransfer {
            ToolbarItem(placement: .bottomBar) {
              HStack {
                Button {
                  onTransfer()
                } label: {
                  Label(transferLabel, systemImage: "arrow.left.arrow.right")
                    .font(.system(size: 14))
                }
                .disabled(text != record.text("body"))
                Spacer()
                if text != record.text("body") {
                  Text("先保存编辑再迁移")
                    .font(.system(size: 12))
                    .foregroundStyle(Ink.text3)
                }
              }
            }
          }
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

/// Read-only selectable UITextView reporting exact half-open UTF-16 ranges for partial transfers.
private struct SelectableTransferTextView: UIViewRepresentable {
  let text: String
  @Binding var selection: Range<Int>?

  func makeCoordinator() -> Coordinator { Coordinator(selection: $selection) }

  func makeUIView(context: Context) -> UITextView {
    let tv = UITextView()
    tv.isEditable = false
    tv.isSelectable = true
    tv.isScrollEnabled = true
    tv.backgroundColor = .clear
    tv.textColor = UIColor.label
    tv.font = UIFont.monospacedSystemFont(ofSize: 14, weight: .regular)
    tv.textContainerInset = UIEdgeInsets(top: 10, left: 8, bottom: 10, right: 8)
    tv.delegate = context.coordinator
    tv.text = text
    return tv
  }

  func updateUIView(_ uiView: UITextView, context: Context) {
    if uiView.text != text {
      uiView.text = text
      uiView.selectedRange = NSRange(location: 0, length: 0)
    } else if selection == nil && uiView.selectedRange.length > 0 {
      uiView.selectedRange = NSRange(location: 0, length: 0)
    }
  }

  final class Coordinator: NSObject, UITextViewDelegate {
    @Binding var selection: Range<Int>?
    init(selection: Binding<Range<Int>?>) { _selection = selection }
    func textViewDidChangeSelection(_ textView: UITextView) {
      let r = textView.selectedRange
      let next: Range<Int>? = r.length > 0 ? (r.location..<(r.location + r.length)) : nil
      if selection != next {
        DispatchQueue.main.async { self.selection = next }
      }
    }
  }
}

/// Move a full record or a UTF-16 selected slice between Ideas and Raw Material while preserving business day.
struct JournalTransferSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let initialSource: Record
  let targetKind: JournalKind
  let onTransferred: (JournalTransferTarget) -> Void
  @State private var snapshot: Record
  @State private var selection: Range<Int>?
  @State private var submitting = false
  @State private var errorMessage: String?

  init(source: Record, targetKind: JournalKind, onTransferred: @escaping (JournalTransferTarget) -> Void) {
    self.initialSource = source
    self.targetKind = targetKind
    self.onTransferred = onTransferred
    self._snapshot = State(initialValue: source)
  }

  private var bodyText: String { snapshot.text("body") }
  private var dayText: String { snapshot.text("day") }
  private var liveRecord: Record? {
    studio.all(snapshot.type).first { $0.id == snapshot.id }
  }
  private var removedExternally: Bool { liveRecord == nil || liveRecord?.deleted == true }
  private var changedExternally: Bool {
    guard let live = liveRecord, !live.deleted else { return false }
    return live.version != snapshot.version || live.data != snapshot.data
  }
  private var selectedSlice: String? {
    guard let r = selection else { return nil }
    let units = Array(bodyText.utf16)
    guard r.lowerBound >= 0, r.upperBound <= units.count, !r.isEmpty else { return nil }
    return String(utf16CodeUnits: Array(units[r]), count: r.count)
  }
  private var remainingSlice: String {
    guard let r = selection else { return "" }
    let units = Array(bodyText.utf16)
    guard r.lowerBound >= 0, r.upperBound <= units.count, !r.isEmpty else { return bodyText }
    let rest = Array(units[..<r.lowerBound]) + Array(units[r.upperBound...])
    return String(utf16CodeUnits: rest, count: rest.count)
  }
  private var selectionBlank: Bool {
    if let slice = selectedSlice {
      return slice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
    return false
  }
  private var payloadUnits: Int {
    selection?.count ?? bodyText.utf16.count
  }
  private var tooLong: Bool {
    targetKind == .idea && payloadUnits > 100_000
  }
  private var removesWholeSource: Bool {
    selection == nil || remainingSlice.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        HStack(spacing: 6) {
          Text("移动而非复制")
          Text("·")
          Text("保留原日期 \(dayText)")
          if targetKind == .idea {
            Text("·")
            Text("进入待实现")
          }
        }
        .font(.system(size: 12))
        .foregroundStyle(Ink.text3)

        if removedExternally {
          Text("这条记录已在另一端移除，无法继续迁移。")
            .font(.system(size: 13))
            .foregroundStyle(Ink.amber)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Ink.raised, in: RoundedRectangle(cornerRadius: 10))
        } else if changedExternally {
          HStack(spacing: 8) {
            Text("另一端已更新原文，请载入后再重新选段。")
              .font(.system(size: 12))
              .foregroundStyle(Ink.amber)
            Spacer()
            Button("载入最新") {
              if let live = liveRecord {
                snapshot = live
                selection = nil
                errorMessage = nil
              }
            }
            .buttonStyle(.chip)
          }
          .padding(10)
          .background(Ink.raised, in: RoundedRectangle(cornerRadius: 10))
        }

        HStack {
          Text("长按拖选一段文字可仅移动选段；不选则移动整条。")
            .font(.system(size: 12))
            .foregroundStyle(Ink.text3)
          Spacer()
          if selection != nil {
            Button("清除选区") { selection = nil }
              .font(.system(size: 12))
              .foregroundStyle(Ink.text2)
          }
        }

        SelectableTransferTextView(text: bodyText, selection: $selection)
          .frame(minHeight: 150, maxHeight: 260)
          .background(Ink.bg, in: RoundedRectangle(cornerRadius: 10))
          .overlay(RoundedRectangle(cornerRadius: 10).stroke(Ink.line, lineWidth: 1))

        VStack(alignment: .leading, spacing: 4) {
          if selectionBlank {
            Text("当前选区只有空白字符，请重新选择有效文字。")
              .font(.system(size: 12))
              .foregroundStyle(Ink.amber)
          } else if tooLong {
            Text("当前内容超过想法暂存单条上限（100,000 字符），请缩小选区。")
              .font(.system(size: 12))
              .foregroundStyle(Ink.amber)
          } else if let slice = selectedSlice {
            Text("移动选段（\(slice.utf16.count) 字符）→ \(targetKind.title)")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(Ink.text)
            Text(removesWholeSource ? "选区已覆盖全部正文，移动后原条目会从原列表移除。" : "未选中的其余文字会留在原条目中。")
              .font(.system(size: 12))
              .foregroundStyle(Ink.text3)
          } else {
            Text("移动整条（\(bodyText.utf16.count) 字符）→ \(targetKind.title)")
              .font(.system(size: 13, weight: .semibold))
              .foregroundStyle(Ink.text)
            Text("整条移动后原条目将离开原列表，并在 \(dayText) 生成新记录。")
              .font(.system(size: 12))
              .foregroundStyle(Ink.text3)
          }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Ink.raised, in: RoundedRectangle(cornerRadius: 10))

        if let errorMessage {
          Text(errorMessage)
            .font(.system(size: 12))
            .foregroundStyle(Ink.amber)
        }

        Spacer(minLength: 0)
      }
      .padding(16)
      .background(Ink.card)
      .navigationTitle("移至\(targetKind.title)")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("取消") { dismiss() }.disabled(submitting)
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(submitting ? "移动中…" : (selection == nil ? "移动整条" : "移动选段")) {
            submitting = true
            errorMessage = nil
            let currentSnapshot = snapshot
            let currentSelection = selection
            Task {
              let result = await studio.transferJournalText(currentSnapshot, selection: currentSelection)
              submitting = false
              switch result {
              case .success(let createdId):
                onTransferred(JournalTransferTarget(id: createdId, kind: targetKind, day: currentSnapshot.text("day")))
                dismiss()
              case .failure(.changed(let msg)):
                if let live = studio.all(currentSnapshot.type).first(where: { $0.id == currentSnapshot.id }) {
                  snapshot = live
                  selection = nil
                }
                errorMessage = msg
              case .failure(.invalid(let msg)):
                errorMessage = msg
              }
            }
          }
          .fontWeight(.semibold)
          .disabled(submitting || removedExternally || changedExternally || selectionBlank || tooLong)
        }
      }
    }
    .studioSheet()
    .presentationDetents([.large])
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
