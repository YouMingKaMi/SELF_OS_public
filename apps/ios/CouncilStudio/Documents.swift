import CouncilCore
import SwiftUI

struct DocumentsScreen: View {
  @Environment(Studio.self) private var studio
  let kind: String
  @State private var query = ""
  @State private var creating = false
  var title: String { ["thought": "个人思考", "monthly": "月报", "note": "资料笔记"][kind] ?? "文章" }
  var docs: [Record] {
    studio.all("document").filter {
      $0.text("kind") == kind
        && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)
          || $0.text("body").localizedCaseInsensitiveContains(query))
    }.sorted { $0.updatedAt > $1.updatedAt }
  }
  var body: some View {
    List {
      ForEach(docs) { doc in
        NavigationLink {
          ReaderScreen(id: doc.id)
        } label: {
          VStack(alignment: .leading, spacing: 5) {
            Text(doc.title).font(.system(size: 17, weight: .semibold)).foregroundStyle(Ink.text).lineLimit(2)
            Text(Self.excerpt(doc.text("body"))).font(Ink.meta).foregroundStyle(Ink.text2).lineLimit(2)
              .lineSpacing(2)
            HStack(spacing: 6) {
              Text(kind == "monthly" ? doc.text("month") : doc.text("day"))
              if kind == "note", let domain = studio.record(doc.text("domainId"), in: "domain") {
                Text("· " + domain.title)
              }
            }.font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
          }.padding(.vertical, 4)
        }.cardRow()
      }
      if docs.isEmpty {
        Section {
          VStack(alignment: .leading, spacing: 10) {
            Text(query.isEmpty ? "从一篇文字开始" : "没有找到相关文章").font(Ink.title)
            if query.isEmpty {
              Button("开始写作") { creating = true }.buttonStyle(.pillProminent)
            }
          }.padding(.vertical, 8).cardRow()
        }
      }
    }
    .studioList()
    .searchable(text: $query, prompt: "搜索标题或正文")
    .studioScreen(title)
    .toolbar {
      Button {
        creating = true
      } label: {
        Image(systemName: "square.and.pencil")
      }.accessibilityLabel("新建文章")
    }
    .sheet(isPresented: $creating) { DocumentEditor(kind: kind, record: nil) }
  }
  static func excerpt(_ body: String) -> String {
    body.replacingOccurrences(of: #"[#*`>\-]"#, with: "", options: .regularExpression)
      .replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
  }
}

struct ReaderScreen: View {
  @Environment(Studio.self) private var studio
  let id: String
  @State private var editing = false
  var body: some View {
    let doc = studio.record(id, in: "document")
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if let doc {
          Text(doc.title).font(.system(size: 28, weight: .bold)).foregroundStyle(Ink.text)
          HStack(spacing: 8) {
            Text(doc.text("kind") == "monthly" ? doc.text("month") : doc.text("day"))
            Text("· \(doc.text("body").count) 字")
            if doc.text("kind") == "note", !doc.text("source").isEmpty, doc.text("source") != "unknown" {
              Text(Words.of(doc.text("source"))).padding(.horizontal, 7).padding(.vertical, 2)
                .overlay(Capsule().stroke(Ink.line))
            }
          }.font(.system(size: 13)).monospacedDigit().foregroundStyle(Ink.text3)
          Hairline().padding(.vertical, 4)
          MarkdownView(source: doc.text("body"))
        }
      }.padding(.horizontal, 22).padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Ink.bg)
    .studioScreen("")
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      if let doc {
        ShareLink(item: doc.text("body"), subject: Text(doc.title)) { Image(systemName: "square.and.arrow.up") }
        Button("编辑") { editing = true }
      }
    }
    .sheet(isPresented: $editing) {
      if let doc { DocumentEditor(kind: doc.text("kind"), record: doc) }
    }
  }
}

/// Native Markdown rendering from parsed blocks; no web view, untrusted HTML stays text.
struct MarkdownView: View {
  let source: String
  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(Array(MarkdownBlocks.parse(source).enumerated()), id: \.offset) { _, block in
        switch block.kind {
        case .heading(let level):
          Text(inline(block.text)).font(.system(size: level == 1 ? 22 : level == 2 ? 19 : 17, weight: .semibold))
            .foregroundStyle(Ink.text).padding(.top, 8)
        case .bullet(let marker):
          HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(marker.count > 1 ? marker : "•").foregroundStyle(Ink.text3)
            Text(inline(block.text))
          }.font(.system(size: 17)).lineSpacing(6).foregroundStyle(Ink.text)
        case .quote:
          Text(inline(block.text)).font(.system(size: 16)).italic().foregroundStyle(Ink.text2).lineSpacing(5)
            .padding(.leading, 14).overlay(alignment: .leading) { Capsule().fill(Ink.text3).frame(width: 2) }
        case .code:
          ScrollView(.horizontal, showsIndicators: false) {
            Text(block.text).font(.system(size: 13, design: .monospaced)).foregroundStyle(Ink.text).padding(14)
          }.background(Ink.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        case .divider:
          Hairline()
        case .paragraph:
          Text(inline(block.text)).font(.system(size: 17)).lineSpacing(7).foregroundStyle(Ink.text)
        }
      }
    }.textSelection(.enabled)
  }
  func inline(_ text: String) -> AttributedString {
    (try? AttributedString(
      markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text)
  }
}

struct DocumentEditor: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let kind: String
  let record: Record?
  @State private var title = ""
  @State private var text = ""
  @State private var domainId = ""
  @State private var source = "unknown"
  @State private var day = Date()
  var body: some View {
    NavigationStack {
      VStack(alignment: .leading, spacing: 12) {
        TextField("标题", text: $title).font(.system(size: 24, weight: .bold))
        HStack(spacing: 10) {
          DatePicker("", selection: $day, displayedComponents: .date).labelsHidden()
          if kind == "note" {
            Picker("领域", selection: $domainId) {
              Text("不属于领域").tag("")
              ForEach(studio.all("domain")) { Text($0.title).tag($0.id) }
            }
            if !domainId.isEmpty {
              Picker("来源", selection: $source) {
                ForEach(["unknown", "original", "ai", "assisted", "excerpt"], id: \.self) { Text(Words.of($0)).tag($0) }
              }
            }
          }
        }.font(Ink.meta)
        Hairline()
        TextEditor(text: $text).font(.system(size: 16)).scrollContentBackground(.hidden)
          .overlay(alignment: .topLeading) {
            if text.isEmpty {
              Text("从这里开始写，支持 Markdown…").foregroundStyle(Ink.text3).padding(.top, 8).padding(.leading, 5)
                .allowsHitTesting(false)
            }
          }
      }.padding(.horizontal, 20).padding(.top, 8).background(Ink.card)
        .environment(\.locale, Locale(identifier: "zh_CN"))
        .navigationTitle(record == nil ? "新文章" : "编辑").navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
          ToolbarItem(placement: .confirmationAction) {
            Button("保存") { save() }.fontWeight(.semibold)
              .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
          }
        }
    }.studioSheet().presentationDetents([.large]).interactiveDismissDisabled(!text.isEmpty && record == nil)
      .onAppear {
        guard let record else {
          if kind == "monthly" { title = Day.monthTitle(String(Day.today.prefix(7))) + " · 月报" }
          return
        }
        title = record.title
        text = record.text("body")
        domainId = record.text("domainId")
        source = record.text("source", "unknown")
        day = CalendarDays.date(record.text("day")) ?? Date()
      }
  }
  func save() {
    var data: [String: JSONValue] = record?.data ?? [:]
    data["title"] = .string(title)
    data["body"] = .string(text)
    data["kind"] = .string(kind)
    data["day"] = .string(CalendarDays.string(day))
    if kind == "monthly" { data["month"] = .string(String(CalendarDays.string(day).prefix(7))) }
    data["domainId"] = kind == "note" && !domainId.isEmpty ? .string(domainId) : nil
    data["source"] = kind == "note" && !domainId.isEmpty ? .string(source) : nil
    Task { if await studio.save("document", data, id: record?.id) != nil { dismiss() } }
  }
}
