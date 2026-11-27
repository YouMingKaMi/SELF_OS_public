import CouncilCore
import SwiftUI

func readingLink(_ text: String) -> URL? {
  let pattern = #"https?://[^\s<>"“”。，；！？、]+"#
  guard let range = text.range(of: pattern, options: [.regularExpression, .caseInsensitive]),
    let url = URL(string: String(text[range])),
    let host = url.host, !host.isEmpty,
    let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme)
  else { return nil }
  return url
}

struct ReadingListScreen: View {
  @Environment(Studio.self) private var studio
  @State private var status = "all"
  @State private var tag = ""
  @State private var joining: Record?
  @State private var search = ""
  @State private var editing: Editor?
  @State private var deleting: Record?

  private struct Editor: Identifiable {
    let id = UUID()
    var record: Record? = nil
  }

  var body: some View {
    let query = search.trimmingCharacters(in: .whitespacesAndNewlines)
    let bookmarks = studio.all("readingItem")
    let tags = Set(bookmarks.flatMap { $0.data["tags"]?.strings ?? [] }).sorted()
    let rows = bookmarks.filter { row in
      let itemTags = row.data["tags"]?.strings ?? []
      return (status == "all" || row.text("status") == status) && (tag.isEmpty || itemTags.contains(tag)) &&
        (query.isEmpty || (["title", "source", "note"].map { row.text($0) } + itemTags)
          .contains { $0.localizedCaseInsensitiveContains(query) })
    }.sorted { $0.updatedAt > $1.updatedAt }

    List {
      Section {
        HStack {
          ChipBar(options: [("all", "全部"), ("unread", "未初读"), ("read", "已初读")], selection: $status)
          if !tags.isEmpty {
            Menu {
              Button("全部标签") { tag = "" }
              ForEach(tags, id: \.self) { value in Button(value) { tag = value } }
            } label: {
              Label(tag.isEmpty ? "标签" : tag, systemImage: "line.3.horizontal.decrease")
                .font(Ink.meta).lineLimit(1)
            }
          }
        }.listRowInsets(EdgeInsets()).listRowBackground(Color.clear)
      }
      Section {
        ForEach(rows) { row in line(row).cardRow() }
        if rows.isEmpty {
          Text(!query.isEmpty ? "没有匹配的收藏" :
            status == "read" ? "暂无已初读收藏" : "粘贴一个链接，或记下文章标题。")
            .font(Ink.meta).foregroundStyle(Ink.text3).cardRow()
        }
      }
    }
    .studioList()
    .searchable(text: $search, placement: .navigationBarDrawer(displayMode: .always), prompt: "搜索收藏")
    .toolbar(.hidden, for: .tabBar)
    .studioScreen("待研究清单")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("添加收藏", systemImage: "plus") { editing = Editor() }
      }
    }
    .sheet(item: $editing) { editor in
      ReadingEditorSheet(record: editor.record) {
        if editor.record == nil {
          status = "all"
          tag = ""
          search = ""
        }
      }
    }
    .sheet(item: $joining) { item in JoinPracticeSheet(item: item) }
    .confirmationDialog("移入回收站？", isPresented: Binding(
      get: { deleting != nil }, set: { if !$0 { deleting = nil } }
    ), titleVisibility: .visible, presenting: deleting) { row in
      Button("移入回收站", role: .destructive) { Task { await studio.remove(row) } }
    } message: { row in
      Text(row.text("title"))
    }
  }

  private func line(_ row: Record) -> some View {
    let title = row.text("title")
    let source = row.text("source")
    let note = row.text("note")
    let link = readingLink(note) ?? readingLink(title)
    let unread = row.text("status") == "unread"
    let action = unread ? "标记初读" : "撤销初读"
    let event = studio.all("practiceEvent").first { $0.text("readingItemId") == row.id }
    let tags = row.data["tags"]?.strings ?? []
    return HStack(alignment: .top, spacing: 10) {
      VStack(alignment: .leading, spacing: 5) {
        ReadingRowContent(title: title, source: source, note: note, link: link)
        if !tags.isEmpty || !unread {
          Text((tags.map { "#" + $0 } + (unread ? [] : ["已初读"])).joined(separator: " · "))
            .font(Ink.meta).foregroundStyle(Ink.text3)
        }
        if let event {
          NavigationLink {
            PracticeScreen(requestedEventId: event.id)
          } label: {
            HStack {
              Text(eventPath(event)).lineLimit(2)
              EventTimeLabel(sessions: studio.all("session").filter { $0.text("eventId") == event.id })
            }.font(Ink.meta).foregroundStyle(Ink.text2)
          }.buttonStyle(.borderless)
        }
      }.frame(maxWidth: .infinity, alignment: .leading)
      Menu {
        Button(action, systemImage: unread ? "checkmark" : "arrow.uturn.backward") {
          toggle(row)
        }
        if event == nil { Button("加入推进台", systemImage: "flag") { joining = row } }
        Button("编辑", systemImage: "pencil") { editing = Editor(record: row) }
        Button("移除", systemImage: "trash", role: .destructive) { deleting = row }
      } label: {
        Image(systemName: "ellipsis").foregroundStyle(Ink.text2)
          .frame(minWidth: 44, minHeight: 44)
      }
      .accessibilityLabel("收藏操作")
    }
    .swipeActions(edge: .leading, allowsFullSwipe: false) {
      Button(action, systemImage: "checkmark") { toggle(row) }.tint(Ink.live)
    }
  }

  private func eventPath(_ event: Record) -> String {
    [
      studio.record(event.text("domainId"), in: "domain")?.title,
      studio.record(event.text("activityId"), in: "activity")?.title,
      event.text("status") == "resolved" ? "已完成" : Words.of(event.text("status")),
    ].compactMap { $0 }.joined(separator: " / ")
  }

  private func toggle(_ row: Record) {
    let next = row.text("status") == "unread" ? "read" : "unread"
    Task { await studio.update(row, ["status": .string(next)]) }
  }
}

private struct ReadingRowContent: View {
  let title: String
  let source: String
  let note: String
  let link: URL?
  @State private var expanded = false

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      if !note.isEmpty && note != title {
        Button { withAnimation(.snappy) { expanded.toggle() } } label: {
          VStack(alignment: .leading, spacing: 4) {
            headline
            Text(note).font(Ink.meta).foregroundStyle(Ink.text2)
              .lineLimit(expanded ? nil : 1)
          }
          .frame(maxWidth: .infinity, alignment: .leading)
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(expanded ? "收起说明" : "展开说明")
      } else {
        headline
      }
      if let link {
        Link(destination: link) { Label("打开原文", systemImage: "arrow.up.right").font(Ink.meta) }
          .buttonStyle(.borderless).foregroundStyle(Ink.text2)
          .padding(.vertical, 4)
      }
    }
  }

  private var headline: some View {
    VStack(alignment: .leading, spacing: 3) {
      Text(title).font(Ink.body.weight(.semibold)).foregroundStyle(Ink.text)
      if !source.isEmpty { Text(source).font(Ink.meta).foregroundStyle(Ink.text3) }
    }
  }
}

private struct ReadingEditorSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let record: Record?
  let onSaved: () -> Void
  @State private var title = ""
  @State private var source = ""
  @State private var tags = ""
  @State private var note = ""
  @State private var saving = false

  private var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var trimmedSource: String { source.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var trimmedNote: String { note.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var savedTitle: String { trimmedTitle.isEmpty ? readingLink(trimmedNote)?.absoluteString ?? "" : trimmedTitle }
  private var latest: Record? {
    guard let record else { return nil }
    return studio.all("readingItem").first { $0.id == record.id }
  }
  private var valid: Bool {
    !savedTitle.isEmpty && savedTitle.utf16.count <= 2000 && trimmedSource.utf16.count <= 120 &&
      trimmedNote.utf16.count <= 10000 && tags.utf16.count <= 300 && (record == nil || latest != nil)
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("标题或网址", text: $title)
          TextField("来源（如微信、X）", text: $source)
          TextField("标签（如 AI、计算机）", text: $tags)
          TextField("说明（网址或备注）", text: $note, axis: .vertical).lineLimit(3...8)
            .textInputAutocapitalization(.never)
        }.listRowBackground(Ink.raised)
        if record != nil && latest == nil {
          Text("这条收藏已被移除。").foregroundStyle(Ink.text3)
        }
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .navigationTitle(record == nil ? "添加收藏" : "编辑收藏")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存", action: save).fontWeight(.semibold).disabled(!valid || saving)
        }
      }
    }
    .studioSheet()
    .interactiveDismissDisabled(saving)
    .onAppear {
      title = record?.text("title") ?? ""
      source = record?.text("source") ?? ""
      tags = (record?.data["tags"]?.strings ?? []).joined(separator: "、")
      note = record?.text("note") ?? ""
    }
  }

  private func save() {
    guard valid, !saving else { return }
    saving = true
    let savedNote = trimmedNote.isEmpty && readingLink(savedTitle) != nil ? savedTitle : trimmedNote
    let tagValues = tags.split(whereSeparator: { ",，、".contains($0) })
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    var seen = Set<String>()
    let data: [String: JSONValue] = [
      "title": .string(savedTitle), "source": .string(trimmedSource),
      "tags": .array(tagValues.filter { seen.insert($0).inserted }.map(JSONValue.string)),
      "note": .string(savedNote), "status": .string(latest?.text("status") ?? "unread"),
    ]
    Task {
      let result = await studio.save("readingItem", data, id: record?.id)
      saving = false
      if result != nil {
        onSaved()
        dismiss()
      }
    }
  }
}

struct EventTimeLabel: View {
  let sessions: [Record]
  var body: some View {
    if sessions.contains(where: { $0.text("status") == "running" }) {
      TimelineView(.periodic(from: .now, by: 1)) { label(at: $0.date) }
    } else {
      label(at: Date())
    }
  }

  private func label(at now: Date) -> some View {
    let total = TimeMath.summarize(sessions, now: now).daily.values.reduce(0, +)
    return Text(Clock.digits(total)).monospacedDigit().accessibilityLabel("累计用时 " + Clock.digits(total))
  }
}

private struct JoinPracticeSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let item: Record
  @State private var domainId = ""
  @State private var activityId = ""
  @State private var saving = false
  var body: some View {
    let domains = studio.all("domain")
    let activities = studio.all("activity").filter { $0.text("domainId") == domainId && !$0.flag("archived") }
    NavigationStack {
      Form {
        Section {
          Text(item.title)
          Picker("领域", selection: $domainId) {
            Text("选择领域").tag("")
            ForEach(domains) { Text($0.title).tag($0.id) }
          }
          Picker("子领域", selection: $activityId) {
            Text("整个领域").tag("")
            ForEach(activities) { Text($0.title).tag($0.id) }
          }.disabled(domainId.isEmpty)
          if domains.isEmpty { Text("请先在个人推进台添加一个领域。").foregroundStyle(Ink.text3) }
        }.listRowBackground(Ink.raised)
      }.scrollContentBackground(.hidden).background(Ink.card)
        .navigationTitle("加入推进台").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() }.disabled(saving) }
          ToolbarItem(placement: .confirmationAction) {
            Button("创建事件", action: save).disabled(domainId.isEmpty || saving)
          }
        }
    }.studioSheet().interactiveDismissDisabled(saving)
      .onChange(of: domainId) { _, _ in activityId = "" }
      .onAppear {
        let tags = item.data["tags"]?.strings ?? []
        domainId = domains.first { domain in tags.contains { $0.caseInsensitiveCompare(domain.title) == .orderedSame } }?.id ?? ""
      }
  }

  private func save() {
    guard !saving, !domainId.isEmpty else { return }
    saving = true
    var data: [String: JSONValue] = [
      "domainId": .string(domainId), "readingItemId": .string(item.id),
      "title": .string(item.title), "status": .string("active"),
    ]
    if !activityId.isEmpty { data["activityId"] = .string(activityId) }
    let id = StableID.forKey("practiceEvent:reading:" + item.id)
    Task {
      let saved = await studio.save("practiceEvent", data, id: id)
      saving = false
      if saved != nil { dismiss() }
    }
  }
}
