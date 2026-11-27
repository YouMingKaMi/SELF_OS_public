import CouncilCore
import SwiftUI

enum MemoirPeriod: String, CaseIterable, Identifiable {
  case highSchool = "high_school"
  case middleSchool = "middle_school"
  case primaryAndBelow = "primary_and_below"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .highSchool: "高中"
    case .middleSchool: "初中"
    case .primaryAndBelow: "小学及以下"
    }
  }

  static func from(_ raw: String) -> MemoirPeriod {
    MemoirPeriod(rawValue: raw) ?? .highSchool
  }
}

struct MemoirScreen: View {
  @Environment(Studio.self) private var studio
  @State private var periodFilter: MemoirPeriod? = nil
  @State private var chronological = false // false: 高中→小学, true: 小学→高中
  @State private var query = ""
  @State private var creating = false
  @State private var draftPeriod: MemoirPeriod = .highSchool
  @State private var quickTitle = ""
  @State private var createdId: String?
  @FocusState private var quickFocused: Bool

  private var orderedPeriods: [MemoirPeriod] {
    chronological ? MemoirPeriod.allCases.reversed() : MemoirPeriod.allCases
  }

  private var allRecords: [Record] {
    studio.all("memoir").sorted { lhs, rhs in
      let lo = lhs.data["order"]?.numberValue ?? Double.greatestFiniteMagnitude
      let ro = rhs.data["order"]?.numberValue ?? Double.greatestFiniteMagnitude
      if lo != ro { return lo < ro }
      return lhs.updatedAt > rhs.updatedAt
    }
  }

  private var filteredRecords: [Record] {
    let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
    return allRecords.filter { item in
      if let pf = periodFilter, MemoirPeriod.from(item.text("period")) != pf {
        return false
      }
      if q.isEmpty { return true }
      return item.title.localizedCaseInsensitiveContains(q)
        || item.text("approxTime").localizedCaseInsensitiveContains(q)
        || item.text("detail").localizedCaseInsensitiveContains(q)
    }
  }

  var body: some View {
    let items = filteredRecords
    List {
      if let pf = periodFilter {
        Section {
          HStack {
            Text("当前筛选：\(pf.title)")
              .font(Ink.meta)
              .foregroundStyle(Ink.text3)
            Spacer()
            Button("清除") { periodFilter = nil }
              .font(Ink.meta)
              .foregroundStyle(Ink.text2)
              .buttonStyle(.plain)
          }
          .cardRow()
        }
      }

      if items.isEmpty {
        Section {
          VStack(alignment: .leading, spacing: 8) {
            Text(query.isEmpty ? "大学之前的记忆档案" : "没有找到相关回忆")
              .font(Ink.title)
              .foregroundStyle(Ink.text)
            Text(
              query.isEmpty
                ? "突然想起一件大学前的事，可以先在下方选个阶段写下标题，点进去慢慢补全所有细节。"
                : "换个关键词试试，或清空筛选查看全部阶段。"
            )
            .font(Ink.meta)
            .foregroundStyle(Ink.text3)
            if query.isEmpty {
              Button("写下第一段回忆") { creating = true }
                .buttonStyle(.pillProminent)
                .padding(.top, 4)
            }
          }
          .padding(.vertical, 8)
          .cardRow()
        }
      } else {
        ForEach(orderedPeriods) { period in
          let group = items.filter { MemoirPeriod.from($0.text("period")) == period }
          if !group.isEmpty {
            Section {
              ForEach(group) { item in
                NavigationLink {
                  MemoirDetailScreen(id: item.id)
                } label: {
                  memoirRow(item)
                }
                .cardRow()
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                  Button("删除", systemImage: "trash", role: .destructive) {
                    Task { await studio.remove(item) }
                  }
                }
              }
            } header: {
              HStack {
                Text(period.title)
                  .font(.system(size: 13, weight: .semibold))
                  .foregroundStyle(Ink.text2)
                Spacer()
                Text("\(group.count) 段")
                  .font(Ink.meta)
                  .monospacedDigit()
                  .foregroundStyle(Ink.text3)
              }
              .textCase(nil)
            }
          }
        }
      }
    }
    .studioList()
    .searchable(text: $query, prompt: "搜索事件标题、大致时间或细节")
    .safeAreaInset(edge: .bottom) {
      quickCaptureBar
    }
    .toolbar(.hidden, for: .tabBar)
    .studioScreen("回忆录")
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Section("阶段筛选") {
            Button {
              periodFilter = nil
            } label: {
              Label("全部阶段", systemImage: periodFilter == nil ? "checkmark" : "")
            }
            ForEach(MemoirPeriod.allCases) { p in
              Button {
                periodFilter = p
                draftPeriod = p
              } label: {
                Label(p.title, systemImage: periodFilter == p ? "checkmark" : "")
              }
            }
          }
          Section("时间轴顺序") {
            Button {
              chronological = false
            } label: {
              Label("由近及远（高中 → 小学）", systemImage: !chronological ? "checkmark" : "")
            }
            Button {
              chronological = true
            } label: {
              Label("由早及近（小学 → 高中）", systemImage: chronological ? "checkmark" : "")
            }
          }
        } label: {
          Image(
            systemName: periodFilter == nil
              ? "line.3.horizontal.decrease.circle"
              : "line.3.horizontal.decrease.circle.fill"
          )
        }
        .accessibilityLabel("筛选与排序")
      }
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          creating = true
        } label: {
          Image(systemName: "square.and.pencil")
        }
        .accessibilityLabel("新建回忆")
      }
    }
    .navigationDestination(item: $createdId) { id in
      MemoirDetailScreen(id: id)
    }
    .sheet(isPresented: $creating) {
      MemoirEditorSheet(record: nil, defaultPeriod: periodFilter ?? draftPeriod)
    }
  }

  private func memoirRow(_ item: Record) -> some View {
    let approx = item.text("approxTime")
    let detail = item.text("detail")
    let snippet = detail
      .replacingOccurrences(of: "\n", with: " ")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return VStack(alignment: .leading, spacing: 5) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text(item.title)
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(Ink.text)
          .lineLimit(2)
        Spacer(minLength: 4)
        if !approx.isEmpty {
          Text(approx)
            .font(.system(size: 12))
            .monospacedDigit()
            .foregroundStyle(Ink.text3)
            .lineLimit(1)
        }
      }
      if !snippet.isEmpty {
        Text(snippet)
          .font(Ink.meta)
          .foregroundStyle(Ink.text2)
          .lineLimit(2)
          .lineSpacing(2)
      } else {
        Text("点进去补写回忆细节…")
          .font(.system(size: 12))
          .foregroundStyle(Ink.text3)
      }
    }
    .padding(.vertical, 3)
  }

  private var quickCaptureBar: some View {
    VStack(spacing: 8) {
      HStack(spacing: 6) {
        ForEach(MemoirPeriod.allCases) { p in
          Button {
            draftPeriod = p
          } label: {
            Text(p.title)
              .font(.system(size: 12, weight: draftPeriod == p ? .semibold : .regular))
              .foregroundStyle(draftPeriod == p ? Ink.text : Ink.text3)
              .padding(.horizontal, 12)
              .frame(minHeight: 32)
              .background(
                draftPeriod == p ? Ink.raised : Color.clear,
                in: Capsule()
              )
              .overlay(Capsule().stroke(draftPeriod == p ? Ink.line : Color.clear))
              .contentShape(Capsule())
          }
          .buttonStyle(.plain)
        }
        Spacer()
      }
      HStack(spacing: 8) {
        TextField("想起哪件大学前的事？先立个标题…", text: $quickTitle)
          .font(Ink.body)
          .foregroundStyle(Ink.text)
          .focused($quickFocused)
          .frame(maxWidth: .infinity, minHeight: 28, alignment: .leading)
          .submitLabel(.done)
          .onSubmit { saveQuick() }
        Button {
          saveQuick()
        } label: {
          Image(systemName: "arrow.up.circle.fill")
            .font(.system(size: 26))
            .foregroundStyle(
              quickTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? Ink.text3 : Ink.text
            )
            .frame(width: 38, height: 38)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(quickTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        .accessibilityLabel("记下回忆标题")
      }
      .padding(.leading, 14)
      .padding(.trailing, 6)
      .padding(.vertical, 6)
      .studioInputBox(cornerRadius: 14, fill: Ink.card, stroke: Ink.line) {
        quickFocused = true
      }
    }
    .padding(.horizontal, 16)
    .padding(.top, 8)
    .padding(.bottom, 10)
    .background(Ink.bg.opacity(0.96))
    .overlay(alignment: .top) { Hairline() }
  }

  private func saveQuick() {
    let title = quickTitle.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return }
    quickTitle = ""
    let period = draftPeriod.rawValue
    Task {
      if let savedId = await studio.save("memoir", [
        "period": .string(period),
        "title": .string(title),
      ]) {
        createdId = savedId
      }
    }
  }
}

struct MemoirDetailScreen: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let id: String
  @State private var editing: Record?
  @State private var confirmingDelete = false

  var body: some View {
    let item = studio.record(id, in: "memoir")
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if let item {
          let period = MemoirPeriod.from(item.text("period"))
          let approx = item.text("approxTime")
          let detail = item.text("detail")

          HStack(spacing: 8) {
            Text(period.title)
              .font(.system(size: 12, weight: .medium))
              .foregroundStyle(Ink.text2)
              .padding(.horizontal, 9)
              .padding(.vertical, 3)
              .background(Ink.raised, in: Capsule())
              .overlay(Capsule().stroke(Ink.line))
            if !approx.isEmpty {
              Text(approx)
                .font(.system(size: 13))
                .foregroundStyle(Ink.text3)
            }
            if !detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
              Text("· \(detail.trimmingCharacters(in: .whitespacesAndNewlines).count) 字")
                .font(.system(size: 12))
                .monospacedDigit()
                .foregroundStyle(Ink.text3)
            }
          }

          Text(item.title)
            .font(.system(size: 26, weight: .bold))
            .foregroundStyle(Ink.text)
            .textSelection(.enabled)

          Hairline().padding(.vertical, 2)

          if detail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            VStack(alignment: .leading, spacing: 12) {
              Text("还没有写下具体细节。趁着记忆还清晰，把当时的人物、场景和感受记下来吧。")
                .font(Ink.body)
                .foregroundStyle(Ink.text3)
                .lineSpacing(5)
              Button("补写细节") { editing = item }
                .buttonStyle(.pillProminent)
            }
            .padding(.top, 8)
          } else {
            Text(detail)
              .font(.system(size: 17))
              .foregroundStyle(Ink.text)
              .lineSpacing(8)
              .frame(maxWidth: .infinity, alignment: .leading)
              .textSelection(.enabled)
          }
        } else {
          Text("这条回忆已被移除。")
            .font(Ink.meta)
            .foregroundStyle(Ink.text3)
        }
      }
      .padding(.horizontal, 22)
      .padding(.vertical, 14)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Ink.bg)
    .studioScreen("")
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      if let item {
        ToolbarItem(placement: .topBarTrailing) {
          ShareLink(
            item: [item.title, item.text("detail")].filter { !$0.isEmpty }.joined(separator: "\n\n"),
            subject: Text(item.title)
          ) {
            Image(systemName: "square.and.arrow.up")
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("编辑") { editing = item }
            .fontWeight(.semibold)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Menu {
            Button("删除这段回忆", systemImage: "trash", role: .destructive) {
              confirmingDelete = true
            }
          } label: {
            Image(systemName: "ellipsis.circle")
          }
        }
      }
    }
    .confirmationDialog("确认删除这段回忆？", isPresented: $confirmingDelete, titleVisibility: .visible) {
      Button("删除", role: .destructive) {
        if let item {
          Task {
            await studio.remove(item)
            dismiss()
          }
        }
      }
      Button("取消", role: .cancel) {}
    }
    .sheet(item: $editing) { original in
      MemoirEditorSheet(record: original, defaultPeriod: MemoirPeriod.from(original.text("period")))
    }
  }
}

struct MemoirEditorSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  let defaultPeriod: MemoirPeriod

  @State private var period: MemoirPeriod = .highSchool
  @State private var title = ""
  @State private var approxTime = ""
  @State private var detail = ""
  @State private var saving = false
  @State private var loaded = false
  @State private var saveError: String?
  private enum EditorField { case title, approx }
  @FocusState private var focusedField: EditorField?

  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        Picker("人生阶段", selection: $period) {
          ForEach(MemoirPeriod.allCases) { p in
            Text(p.title).tag(p)
          }
        }
        .pickerStyle(.segmented)

        TextField("大致事件描述（标题）", text: $title, axis: .vertical)
          .font(.system(size: 21, weight: .bold))
          .lineLimit(1...3)
          .focused($focusedField, equals: .title)
          .frame(maxWidth: .infinity, minHeight: 36, alignment: .leading)
          .background(Color.clear.contentShape(Rectangle()).onTapGesture { focusedField = .title })

        TextField("大致时间（可选，如 高二秋天、大概十岁）", text: $approxTime)
          .font(Ink.meta)
          .foregroundStyle(Ink.text2)
          .focused($focusedField, equals: .approx)
          .frame(maxWidth: .infinity, minHeight: 32, alignment: .leading)
          .background(Color.clear.contentShape(Rectangle()).onTapGesture { focusedField = .approx })

        Hairline()

        if let record {
          if let latest = studio.record(record.id, in: "memoir") {
            if latest.version != record.version || latest.data != record.data {
              DisclosureGroup("查看当前同步版本") {
                VStack(alignment: .leading, spacing: 6) {
                  Text(latest.title).bold()
                  Text(latest.text("detail")).textSelection(.enabled)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
              }
              .font(Ink.meta)
            }
          } else {
            Text("这条回忆已被移除，可以复制草稿正文。")
              .font(Ink.meta)
              .foregroundStyle(Ink.text3)
          }
        }

        TextEditor(text: $detail)
          .font(.system(size: 16))
          .scrollContentBackground(.hidden)
          .overlay(alignment: .topLeading) {
            if detail.isEmpty {
              Text("写下你还记得的所有细节——时间地点、一起的人、发生了什么、当时的心情…")
                .foregroundStyle(Ink.text3)
                .padding(.top, 8)
                .padding(.leading, 5)
                .allowsHitTesting(false)
            }
          }

        if let saveError {
          Text(saveError)
            .font(Ink.meta)
            .foregroundStyle(Ink.text2)
        }
      }
      .padding(.horizontal, 20)
      .padding(.top, 10)
      .background(Ink.card)
      .navigationTitle(record == nil ? "记一段回忆" : "编辑回忆")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("取消") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") { save() }
            .fontWeight(.semibold)
            .disabled(saving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
      }
    }
    .studioSheet()
    .presentationDetents([.large])
    .interactiveDismissDisabled(saving || (!detail.isEmpty && record == nil))
    .onAppear {
      guard !loaded else { return }
      loaded = true
      if let record {
        period = MemoirPeriod.from(record.text("period"))
        title = record.title
        approxTime = record.text("approxTime")
        detail = record.text("detail")
      } else {
        period = defaultPeriod
      }
    }
  }

  private func save() {
    let cleanTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleanTitle.isEmpty, !saving else { return }
    let cleanApprox = approxTime.trimmingCharacters(in: .whitespacesAndNewlines)
    var data: [String: JSONValue] = record?.data ?? [:]
    data["period"] = .string(period.rawValue)
    data["title"] = .string(cleanTitle)
    data["approxTime"] = cleanApprox.isEmpty ? nil : .string(cleanApprox)
    data["detail"] = detail.isEmpty ? nil : .string(detail)
    saving = true
    saveError = nil
    Task {
      defer { saving = false }
      if await studio.save("memoir", data, id: record?.id, editBase: record) != nil {
        dismiss()
      } else {
        saveError = studio.error
      }
    }
  }
}
