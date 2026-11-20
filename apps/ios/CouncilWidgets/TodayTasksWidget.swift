import CouncilCore
import SwiftUI
import WidgetKit

struct TodayTasksEntry: TimelineEntry {
  let date: Date
  let tasks: WidgetTaskDay?
  var pending: Set<String> = []
  var preview = false
}

struct TodayTasksProvider: TimelineProvider {
  func placeholder(in context: Context) -> TodayTasksEntry {
    TodayTasksEntry(date: Date(), tasks: WidgetTaskDay(
      day: "", count: 3, rows: [
        WidgetTaskRow(id: "sample-1", title: "看完今天的课程", detail: "18:00", blocked: false),
        WidgetTaskRow(id: "sample-2", title: "整理阅读笔记", detail: "", blocked: false),
        WidgetTaskRow(id: "sample-3", title: "整理下一步计划", detail: "等前置", blocked: true),
      ]), preview: true)
  }

  func getSnapshot(in context: Context, completion: @escaping (TodayTasksEntry) -> Void) {
    if context.isPreview { completion(placeholder(in: context)); return }
    let date = Date()
    completion(entry(date, from: WidgetTasks.read(), pending: Set(WidgetTasks.queuedCompletions().keys)))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<TodayTasksEntry>) -> Void) {
    let date = Date()
    let calendar = CalendarDays.calendar
    let start = calendar.startOfDay(for: date)
    let snapshots = WidgetTasks.read()
    let pending = Set(WidgetTasks.queuedCompletions().keys)
    let midnight = calendar.date(byAdding: .day, value: 1, to: start) ?? date.addingTimeInterval(86400)
    let entries = [entry(date, from: snapshots, pending: pending), entry(midnight, from: snapshots, pending: pending)]
    completion(Timeline(entries: entries, policy: .after(midnight)))
  }

  private func entry(
    _ date: Date, from snapshots: [WidgetTaskDay], pending: Set<String>
  ) -> TodayTasksEntry {
    TodayTasksEntry(date: date, tasks: snapshots.first { $0.day == CalendarDays.string(date) }, pending: pending)
  }
}

struct TodayTasksWidgetView: View {
  @Environment(\.widgetFamily) private var family
  @Environment(\.colorScheme) private var colorScheme
  let entry: TodayTasksEntry

  private var compact: Bool { family == .systemSmall }
  private var taskList: URL { URL(string: "selfos://tasks")! }
  private var newTask: URL { URL(string: "selfos://capture/task")! }

  var body: some View {
    VStack(alignment: .leading, spacing: 7) {
      HStack(spacing: 6) {
        Text("今日任务")
          .font(.system(size: compact ? 14 : 15, weight: .semibold))
          .lineLimit(1)
        if let count = entry.tasks?.count, count > 0 {
          Text(count, format: .number).font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            .accessibilityLabel("\(count) 项待完成")
        }
        Spacer(minLength: 0)
        if !compact {
          Link(destination: newTask) {
            Image(systemName: "plus").font(.caption.weight(.semibold))
              .padding(5).background(.primary.opacity(0.08), in: Circle())
          }.accessibilityLabel("新建任务")
        }
      }
      if let tasks = entry.tasks {
        if tasks.rows.isEmpty {
          Spacer(minLength: 5)
          Label("今天没有待办", systemImage: "checkmark.circle")
            .font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
        } else {
          VStack(spacing: 0) {
            ForEach(tasks.rows.prefix(compact ? 3 : 4)) { row in
              taskRow(row)
              if row.id != tasks.rows.prefix(compact ? 3 : 4).last?.id {
                Divider().padding(.leading, 27)
              }
            }
          }
          .privacySensitive()
        }
      } else {
        Spacer(minLength: 5)
        Text("打开 SELF OS 更新任务")
          .font(.system(size: 13)).foregroundStyle(.secondary)
      }
      Spacer(minLength: 0)
    }
    .foregroundStyle(.primary)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .widgetURL(taskList)
    .containerBackground(for: .widget) {
      colorScheme == .dark ? Color(white: 0.09) : Color(red: 0.97, green: 0.961, blue: 0.936)
    }
  }

  private func taskRow(_ row: WidgetTaskRow) -> some View {
    let pending = entry.pending.contains(row.id)
    return HStack(spacing: 6) {
      if row.blocked || entry.preview || pending {
        Image(systemName: pending ? "clock" : row.blocked ? "circle.dashed" : "circle")
          .font(.system(size: 16)).foregroundStyle(.tertiary).frame(width: 23, height: 25)
          .accessibilityHidden(true)
      } else {
        Button(intent: CompleteWidgetTaskIntent(taskID: row.id)) {
          Image(systemName: "circle").font(.system(size: 17, weight: .medium))
            .foregroundStyle(.secondary).frame(width: 23, height: 25)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("完成\(row.title)")
      }
      // Small widgets have one URL destination. In medium, a title links to that task.
      if !compact, let url = taskURL(row.id) {
        Link(destination: url) { content(row, pending: pending) }
      } else {
        content(row, pending: pending)
      }
    }
  }

  private func taskURL(_ id: String) -> URL? {
    guard UUID(uuidString: id) != nil else { return nil }
    return URL(string: "selfos://task/\(id)")
  }

  private func content(_ row: WidgetTaskRow, pending: Bool) -> some View {
    HStack(spacing: 5) {
      Text(row.title).font(.system(size: 13, weight: .medium)).lineLimit(1)
      Spacer(minLength: 0)
      if !compact, pending || !row.detail.isEmpty {
        Text(pending ? "待 App 确认" : row.detail).font(.system(size: 10).monospacedDigit()).lineLimit(1)
          .foregroundStyle(.secondary)
      }
    }
    .foregroundStyle(row.blocked ? .secondary : .primary)
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityLabel(pending ? "\(row.title)，待 App 确认" : row.title)
  }
}

@main
struct TodayTasksWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: WidgetTasks.kind, provider: TodayTasksProvider()) { entry in
      TodayTasksWidgetView(entry: entry)
    }
    .configurationDisplayName("今日任务")
    .description("在桌面查看并完成 SELF OS 的今日待办。")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}
