import CouncilCore
import Foundation

enum TaskPlanService {
  struct Failure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
  }

  typealias Item = TaskPlanRules.Item

  static func propose(endpoint: String, model: String, apiKey: String, input: String, day: String) async throws -> [Item] {
    let address = endpoint.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let url = URL(string: address), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
      throw Failure(message: "请输入 HTTPS 接口地址。")
    }
    var request = URLRequest(url: url, timeoutInterval: 45)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if !apiKey.isEmpty { request.setValue("Bearer " + apiKey.trimmingCharacters(in: .whitespacesAndNewlines), forHTTPHeaderField: "Authorization") }
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "model": model.trimmingCharacters(in: .whitespacesAndNewlines),
      "messages": [
        ["role": "system", "content": """
          今天是 \(day)。把原文拆成具体待办，只保留原文实际要求。
          只输出 JSON，格式 {"items":[{"key":"a","title":"事项","note":"原文细节","date":"YYYY-MM-DD 或空","time":"HH:MM 或空","after":["前置事项的 key"]}]}。
          无明确先后则 after 为空，日期不明则留空。最多 20 件。
          """],
        ["role": "user", "content": input],
      ],
    ])
    let (data, response) = try await URLSession.shared.data(for: request)
    guard let status = (response as? HTTPURLResponse)?.statusCode, status == 200 else {
      throw Failure(message: "模型接口请求失败（\((response as? HTTPURLResponse)?.statusCode ?? 0)）。")
    }
    do { return try TaskPlanRules.parse(data) }
    catch let error as TaskPlanRules.Failure { throw Failure(message: error.localizedDescription) }
  }
}
