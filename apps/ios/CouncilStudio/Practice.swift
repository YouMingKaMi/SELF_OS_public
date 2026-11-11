import Charts
import CouncilCore
import SwiftUI

struct PracticeScreen: View {
  @Environment(Studio.self) private var studio
  @AppStorage("studio-practice-domain") private var domainId = ""
  @AppStorage("studio-practice-activity") private var activityId = ""
  @State private var problemId = ""
  @State private var solutionId = ""
  @State private var tab = "progress"
  @State private var month = String(Day.today.prefix(7))
  @State private var draft = ""
  @State private var form: EntityForm?
  @State private var manual = false
  var domains: [Record] { studio.all("domain").sorted { $0.number("order") < $1.number("order") } }
  var domain: Record? { domains.first { $0.id == domainId } ?? domains.first }
  var activities: [Record] {
    studio.all("activity").filter { $0.text("domainId") == domain?.id && !$0.flag("archived") }
  }
  var activity: Record? { activities.first { $0.id == activityId } }
  var problems: [Record] {
    studio.all("problem").filter {
      $0.text("domainId") == domain?.id && (activity == nil || $0.text("activityId") == activity?.id)
    }
  }
  var problem: Record? { problems.first { $0.id == problemId } }
  var solutions: [Record] { studio.all("solution") }
  var solution: Record? { solutions.first { $0.id == solutionId && $0.text("problemId") == problemId } }
  var sessions: [Record] { studio.all("session").filter { $0.text("domainId") == domain?.id } }

  var body: some View {
    Page {
      ChipBar(
        options: domains.map { ($0.id, $0.title) },
        selection: Binding(
          get: { domain?.id ?? "" },
          set: {
            domainId = $0
            activityId = ""
            problemId = ""
            solutionId = ""
          }))
      if let domain {
        hero(domain)
        Picker("视图", selection: $tab) {
          Text("进展").tag("progress")
          Text("问题与方案").tag("problems")
          Text("时间").tag("time")
        }.pickerStyle(.segmented).padding(.vertical, 2)
        switch tab {
        case "problems": problemMap
        case "time": timeView
        default: progressView
        }
      } else {
        Card { EmptyNote(text: "添加你的第一个领域，例如 AI、健身或自动化", icon: "scope") }
      }
    }
    .safeAreaInset(edge: .bottom) {
      if domain != nil && tab == "progress" {
        Composer(text: $draft, placeholder: "记下这一步的进展…") { saveProgress() }
      }
    }
    .toolbar(.hidden, for: .tabBar)
    .toolbar {
      Menu {
        Button("补记时间", systemImage: "clock.badge.checkmark") { manual = true }
        Divider()
        Button("新问题", systemImage: "questionmark.circle") {
          form = EntityForm(type: "problem", defaults: problemDefaults)
        }
        if let problem {
          Button("新方案", systemImage: "arrow.triangle.branch") {
            form = EntityForm(
              type: "solution",
              defaults: [
                "problemId": .string(problem.id), "status": .string("active"),
                "parentId": solution.map { .string($0.id) } ?? .null,
              ])
          }
        }
        Button("新子领域", systemImage: "square.split.2x1") {
          if let domain {
            form = EntityForm(type: "activity", defaults: ["domainId": .string(domain.id), "archived": .bool(false)])
          }
        }
        Button("新领域", systemImage: "plus.circle") {
          form = EntityForm(type: "domain", defaults: ["focused": .bool(true), "order": .number(Double(domains.count))])
        }
        if let domain {
          Button("编辑领域", systemImage: "pencil") { form = EntityForm(type: "domain", record: domain) }
        }
      } label: {
        Image(systemName: "plus")
      }
    }
    .studioScreen("推进台")
    .sheet(item: $form) { EntityFormSheet(form: $0) }
    .sheet(isPresented: $manual) {
      if let domain {
        ManualSessionSheet(domain: domain, activity: activity, problem: problem, solution: solution)
      }
    }
  }

  var problemDefaults: [String: JSONValue] {
    var d: [String: JSONValue] = ["domainId": .string(domain?.id ?? ""), "status": .string("active"), "focused": .bool(false)]
    if let activity { d["activityId"] = .string(activity.id) }
    return d
  }

  // MARK: Hero

  func hero(_ domain: Record) -> some View {
    let summary = TimeMath.summarize(sessions, now: Date())
    let monthSeconds = summary.daily.filter { $0.key.hasPrefix(String(Day.today.prefix(7))) }.values.reduce(0, +)
    return Card {
      if let running = studio.runningSession {
        LiveSession(session: running)
      } else {
        VStack(alignment: .leading, spacing: 16) {
          HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 6) {
              Text(scopeTitle).font(.system(size: 22, weight: .bold)).foregroundStyle(Ink.text)
                .lineLimit(2)
              Text(scopePath).font(Ink.meta).foregroundStyle(Ink.text3).lineLimit(1)
            }
            Spacer()
            Button {
              Task { await studio.start(domain: domain, activity: activity, problem: problem, solution: solution) }
            } label: {
              Image(systemName: "play.fill").font(.system(size: 20, weight: .bold)).foregroundStyle(.black)
                .frame(width: 60, height: 60).background(Ink.text, in: Circle())
            }.buttonStyle(.plain).accessibilityLabel("开始推进")
          }
          HStack(spacing: 8) {
            Menu {
              Button("整个领域") {
                activityId = ""
                problemId = ""
                solutionId = ""
              }
              ForEach(activities) { a in
                Button(a.title) {
                  activityId = a.id
                  problemId = ""
                  solutionId = ""
                }
              }
            } label: {
              scopeChip(activity?.title ?? "子领域", on: activity != nil)
            }
            Menu {
              Button("不关联问题") {
                problemId = ""
                solutionId = ""
              }
              ForEach(problems.filter { !["resolved", "discarded"].contains($0.text("status")) }) { p in
                Button(p.title) {
                  problemId = p.id
                  solutionId = ""
                }
              }
            } label: {
              scopeChip(problem?.title ?? "问题", on: problem != nil)
            }
            if problem != nil {
              Menu {
                Button("不关联方案") { solutionId = "" }
                ForEach(tree.filter { $0.0.text("status") != "discarded" }, id: \.0.id) { item in
                  Button(String(repeating: "  ", count: item.1) + item.0.title) { solutionId = item.0.id }
                }
              } label: {
                scopeChip(solution?.title ?? "方案", on: solution != nil)
              }
            }
          }
          Hairline()
          StatRow(items: [
            ("今日", Clock.span(summary.daily[Day.today] ?? 0)),
            ("本月", Clock.span(monthSeconds)),
            ("问题", "\(problems.filter { $0.text("status") == "active" }.count) 进行中"),
          ])
        }
      }
    }
  }
  func scopeChip(_ text: String, on: Bool) -> some View {
    HStack(spacing: 4) {
      Text(text).lineLimit(1)
      Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
    }.font(.system(size: 13, weight: on ? .semibold : .regular))
      .foregroundStyle(on ? Ink.text : Ink.text3).padding(.horizontal, 11).frame(height: 30)
      .background(Ink.raised, in: Capsule())
  }
  var scopeTitle: String { solution?.title ?? problem?.title ?? activity?.title ?? domain?.title ?? "" }
  var scopePath: String {
    [domain?.title, activity?.title, problem?.title].compactMap { $0 }.dropLast(solution == nil ? 1 : 0)
      .joined(separator: " / ").ifEmpty("直接推进这个领域")
  }

  /// Solutions of the chosen problem, depth-first so branches read top to bottom.
  var tree: [(Record, Int)] {
    guard let problem else { return [] }
    let all = solutions.filter { $0.text("problemId") == problem.id }
    var out: [(Record, Int)] = []
    func walk(_ parent: String, _ depth: Int) {
      for s in all.filter({ $0.text("parentId") == parent }) where !out.contains(where: { $0.0.id == s.id }) {
        out.append((s, depth))
        walk(s.id, depth + 1)
      }
    }
    walk("", 0)
    for s in all where !out.contains(where: { $0.0.id == s.id }) { out.append((s, 0)) }
    return out
  }

  // MARK: Progress

  var progressView: some View {
    let logs = studio.all("progress").filter {
      $0.text("domainId") == domain?.id && (activity == nil || $0.text("activityId") == activity?.id)
        && (problem == nil || $0.text("problemId") == problem?.id)
    }.sorted { $0.text("day") == $1.text("day") ? $0.updatedAt > $1.updatedAt : $0.text("day") > $1.text("day") }
    return Card(icon: "text.alignleft", title: "进展", meta: "\(logs.count) 条") {
      VStack(alignment: .leading, spacing: 0) {
        ForEach(Array(logs.prefix(60).enumerated()), id: \.element.id) { index, log in
          if index > 0 { Hairline(inset: 46) }
          HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
              Text(String(Int(log.text("day").suffix(2)) ?? 0))
                .font(.system(size: 17, weight: .semibold, design: .rounded)).foregroundStyle(Ink.text)
              Text(String(Int(log.text("day").dropFirst(5).prefix(2)) ?? 0) + "月").font(Ink.micro)
                .foregroundStyle(Ink.text3)
            }.frame(width: 34)
            VStack(alignment: .leading, spacing: 4) {
              Text(log.text("body")).font(Ink.row).foregroundStyle(Ink.text).lineSpacing(3)
              Text(place(log)).font(.system(size: 12)).foregroundStyle(Ink.text3)
            }
            Spacer(minLength: 0)
          }.padding(.vertical, 11)
            .contextMenu {
              Button("删除", systemImage: "trash", role: .destructive) { Task { await studio.remove(log) } }
            }
        }
        if logs.isEmpty { EmptyNote(text: "每一步进展会按时间留在这里。", icon: "text.alignleft") }
      }
    }
  }
  func place(_ log: Record) -> String {
    if let p = studio.record(log.text("problemId"), in: "problem") {
      return p.title + (studio.record(log.text("solutionId"), in: "solution").map { " / " + $0.title } ?? "")
    }
    return studio.record(log.text("activityId"), in: "activity")?.title ?? "领域记录"
  }
  func saveProgress() {
    guard let domain else { return }
    var data: [String: JSONValue] = [
      "domainId": .string(domain.id), "day": .string(Day.today), "body": .string(draft),
    ]
    if let activity { data["activityId"] = .string(activity.id) }
    if let problem { data["problemId"] = .string(problem.id) }
    if let solution { data["solutionId"] = .string(solution.id) }
    draft = ""
    Task { await studio.save("progress", data) }
  }

  // MARK: Problems

  var problemMap: some View {
    VStack(spacing: Ink.gap) {
      ForEach(problems) { p in
        let open = p.id == problemId
        Card {
          VStack(alignment: .leading, spacing: 12) {
            Button {
              withAnimation(.snappy) {
                problemId = open ? "" : p.id
                solutionId = ""
              }
            } label: {
              HStack(alignment: .top, spacing: 10) {
                StatusDot(status: p.text("status")).padding(.top, 5)
                VStack(alignment: .leading, spacing: 3) {
                  Text(p.title).font(.system(size: 16, weight: .semibold)).foregroundStyle(
                    ["resolved", "discarded"].contains(p.text("status")) ? Ink.text3 : Ink.text)
                  Text(Words.of(p.text("status")) + (open ? " · 正在推进" : "")).font(.system(size: 12))
                    .foregroundStyle(open ? Ink.amber : Ink.text3)
                }
                Spacer()
                Image(systemName: open ? "chevron.up" : "chevron.down").font(.system(size: 12, weight: .bold))
                  .foregroundStyle(Ink.text3)
              }
            }.buttonStyle(.plain)
            .contextMenu {
              Button("编辑问题", systemImage: "pencil") { form = EntityForm(type: "problem", record: p) }
            }
            if open {
              VStack(alignment: .leading, spacing: 0) {
                ForEach(tree, id: \.0.id) { item in
                  let s = item.0
                  Button {
                    withAnimation(.snappy) { solutionId = solutionId == s.id ? "" : s.id }
                  } label: {
                    HStack(spacing: 10) {
                      StatusDot(status: s.text("status"))
                      VStack(alignment: .leading, spacing: 2) {
                        Text(s.title).font(Ink.row)
                          .foregroundStyle(s.text("status") == "discarded" ? Ink.text3 : Ink.text)
                          .strikethrough(s.text("status") == "discarded", color: Ink.text3)
                        if !s.text("reason").isEmpty {
                          Text(s.text("reason")).font(.system(size: 12)).foregroundStyle(Ink.text3).lineLimit(2)
                        }
                      }
                      Spacer()
                      if solutionId == s.id {
                        Image(systemName: "scope").foregroundStyle(Ink.amber).font(.system(size: 13))
                      }
                    }.padding(.vertical, 9).padding(.leading, CGFloat(item.1) * 20)
                      .overlay(alignment: .leading) {
                        if item.1 > 0 {
                          Rectangle().fill(Ink.line).frame(width: 1).padding(.leading, CGFloat(item.1) * 20 - 11)
                        }
                      }
                  }.buttonStyle(.row)
                    .contextMenu {
                      Button("编辑方案", systemImage: "pencil") { form = EntityForm(type: "solution", record: s) }
                      Button("在此下加子方案", systemImage: "arrow.turn.down.right") {
                        form = EntityForm(
                          type: "solution",
                          defaults: ["problemId": .string(p.id), "parentId": .string(s.id), "status": .string("active")])
                      }
                    }
                }
                if tree.isEmpty { EmptyNote(text: "还没有方案；也可以直接推进问题本身。") }
                Button {
                  form = EntityForm(
                    type: "solution",
                    defaults: ["problemId": .string(p.id), "status": .string("active")])
                } label: {
                  Label("添加方案", systemImage: "plus").font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Ink.text2)
                }.buttonStyle(.plain).padding(.top, 8)
              }.padding(.leading, 18)
            }
          }
        }
      }
      if problems.isEmpty {
        Card { EmptyNote(text: "记下一个真正想解决的问题", icon: "questionmark.circle") }
      }
    }
  }

  // MARK: Time

  var timeView: some View {
    let summary = TimeMath.summarize(sessions, now: Date())
    let days = HabitRules.days(in: month)
    let total = days.compactMap { summary.daily[$0] }.reduce(0, +)
    let monthSessions = sessions.filter { $0.text("day").hasPrefix(month) && $0.text("status") != "cancelled" }
    return VStack(spacing: Ink.gap) {
      Card {
        MonthBar(month: $month)
        Figure(value: Clock.span(total), caption: "\(monthSessions.count) 次记录 · 重叠时间已去重", font: Ink.figure)
        Chart {
          ForEach(days, id: \.self) { day in
            BarMark(x: .value("日", Int(day.suffix(2)) ?? 0), y: .value("分钟", (summary.daily[day] ?? 0) / 60), width: 6)
              .foregroundStyle(day == Day.today ? Ink.amber : Ink.text).clipShape(Capsule())
          }
        }.chartXAxis {
          AxisMarks(values: [1, 8, 15, 22, 29]) { AxisValueLabel().foregroundStyle(Ink.text3) }
        }.chartYAxis {
          AxisMarks(position: .trailing) {
            AxisGridLine().foregroundStyle(Ink.line)
            AxisValueLabel().foregroundStyle(Ink.text3)
          }
        }.frame(height: 140)
      }
      Card(icon: "square.split.2x1", title: "子领域") {
        let rows = activities.map { a -> (Record, Double) in
          let s = TimeMath.summarize(sessions.filter { $0.text("activityId") == a.id }, now: Date())
          return (a, days.compactMap { s.daily[$0] }.reduce(0, +))
        }.sorted { $0.1 > $1.1 }
        ForEach(rows, id: \.0.id) { row in
          VStack(alignment: .leading, spacing: 6) {
            HStack {
              Text(row.0.title).font(Ink.row)
              Spacer()
              Text(Clock.span(row.1)).font(.system(size: 14, weight: .semibold, design: .rounded)).monospacedDigit()
            }.foregroundStyle(Ink.text)
            Meter(value: total > 0 ? row.1 / total : 0, height: 4)
          }
        }
        if rows.isEmpty { EmptyNote(text: "还没有子领域") }
      }
      Card(icon: "clock", title: "记录", meta: "\(monthSessions.count)") {
        VStack(spacing: 0) {
          ForEach(Array(monthSessions.sorted { $0.text("day") > $1.text("day") }.enumerated()), id: \.element.id) {
            index, s in
            if index > 0 { Hairline() }
            HStack {
              Text(Day.short(s.text("day"))).font(.system(size: 12)).monospacedDigit().foregroundStyle(Ink.text3)
                .frame(width: 52, alignment: .leading)
              VStack(alignment: .leading, spacing: 2) {
                Text(s.title).font(Ink.row).foregroundStyle(Ink.text).lineLimit(1)
                if s.flag("manual") { Text("补记").font(.system(size: 11)).foregroundStyle(Ink.text3) }
              }
              Spacer()
              Text(Clock.span(Clock.elapsed(s))).font(.system(size: 14, weight: .semibold, design: .rounded))
                .monospacedDigit().foregroundStyle(Ink.text)
            }.padding(.vertical, 10)
              .contextMenu {
                Button("取消这条记录", systemImage: "xmark", role: .destructive) {
                  Task { await studio.control(s, "cancel") }
                }
              }
          }
          if monthSessions.isEmpty { EmptyNote(text: "这个月还没有推进记录") }
        }
      }
    }
  }
}

struct StatusDot: View {
  let status: String
  var body: some View {
    Circle()
      .fill(status == "active" ? Ink.text : status == "resolved" ? Ink.live : .clear)
      .overlay(Circle().stroke(status == "discarded" ? Ink.text3 : Ink.text2, lineWidth: status == "active" || status == "resolved" ? 0 : 1.5))
      .frame(width: 8, height: 8)
  }
}

struct ManualSessionSheet: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  let domain: Record
  let activity: Record?
  let problem: Record?
  let solution: Record?
  @State private var title = ""
  @State private var day = Date()
  @State private var minutes = 30.0
  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("内容", text: $title)
          DatePicker("日期", selection: $day, in: ...Date(), displayedComponents: .date)
        }.listRowBackground(Ink.raised)
        Section {
          VStack(spacing: 10) {
            Text(Clock.span(minutes * 60)).font(Ink.figure).monospacedDigit().contentTransition(.numericText())
            Slider(value: $minutes, in: 5...480, step: 5)
            HStack {
              ForEach([15.0, 30, 45, 60, 90, 120], id: \.self) { m in
                Button(m < 60 ? "\(Int(m))m" : "\(Int(m) / 60)h\(Int(m) % 60 == 0 ? "" : "半")") { minutes = m }
                  .buttonStyle(.chip)
              }
            }
          }.frame(maxWidth: .infinity).animation(.snappy, value: minutes)
        } header: {
          Text("时长")
        }.listRowBackground(Ink.raised)
      }
      .scrollContentBackground(.hidden).background(Ink.card)
      .environment(\.locale, Locale(identifier: "zh_CN"))
      .navigationTitle("补记时间").navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("取消") { dismiss() } }
        ToolbarItem(placement: .confirmationAction) {
          Button("保存") {
            var data: [String: JSONValue] = [
              "domainId": .string(domain.id), "title": .string(title.isEmpty ? domain.title : title),
              "day": .string(CalendarDays.string(day)), "elapsedSeconds": .number(minutes * 60),
              "status": .string("finished"), "manual": .bool(true), "segments": .array([]),
            ]
            if let activity { data["activityId"] = .string(activity.id) }
            if let problem { data["problemId"] = .string(problem.id) }
            if let solution { data["solutionId"] = .string(solution.id) }
            Task {
              await studio.save("session", data)
              dismiss()
            }
          }.fontWeight(.semibold)
        }
      }
    }.studioSheet().presentationDetents([.medium, .large])
      .onAppear { title = solution?.title ?? problem?.title ?? activity?.title ?? domain.title }
  }
}

extension String {
  func ifEmpty(_ fallback: String) -> String { isEmpty ? fallback : self }
}
