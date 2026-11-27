import AVFoundation
import Combine
import CouncilCore
import Speech
import SwiftUI

/// The side button, the app icon quick action and the app all open the same recorder.
struct VoiceIdeaCapture: View {
  @Environment(Studio.self) private var studio
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @Environment(\.scenePhase) private var scenePhase
  @State private var capture = VoiceIdeaSession()
  @State private var confirmDiscard = false

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Text("语音记想法").font(Ink.title)
        Spacer()
        Button {
          if capture.isRecording { confirmDiscard = true } else { dismiss() }
        } label: {
          Image(systemName: "xmark")
            .font(.system(size: 15, weight: .semibold))
            .frame(width: 44, height: 44)
            .background(Ink.raised, in: Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("关闭")
        .disabled(capture.phase == .processing)
      }
      Spacer(minLength: 24)
      content
      Spacer(minLength: 24)
    }
    .padding(.horizontal, 24)
    .padding(.top, 24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .foregroundStyle(Ink.text)
    .background(Ink.bg)
    .presentationDetents([.height(360), .large])
    .presentationDragIndicator(.visible)
    .interactiveDismissDisabled(capture.isRecording || capture.phase == .processing)
    .task { await capture.open() }
    .task(id: capture.phase) {
      guard capture.phase == .saved else { return }
      try? await Task.sleep(for: .milliseconds(950))
      if !Task.isCancelled { dismiss() }
    }
    .onChange(of: scenePhase) { _, phase in
      if phase == .background && capture.isRecording { capture.finish(studio) }
    }
    .onReceive(NotificationCenter.default.publisher(for: AVAudioSession.interruptionNotification)) { notice in
      let type = notice.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
      if type == AVAudioSession.InterruptionType.began.rawValue && capture.isRecording {
        capture.finish(studio)
      }
    }
    .onDisappear { capture.close() }
    .confirmationDialog("舍弃这段录音？", isPresented: $confirmDiscard, titleVisibility: .visible) {
      Button("舍弃录音", role: .destructive) {
        capture.discard()
        dismiss()
      }
      Button("保留", role: .cancel) {}
    }
  }

  @ViewBuilder private var content: some View {
    switch capture.phase {
    case .preparing:
      VStack(spacing: 15) {
        ProgressView().tint(Ink.text)
        Text("正在打开麦克风").font(Ink.body).foregroundStyle(Ink.text2)
      }
    case .recording(let started):
      VStack(spacing: 15) {
        TimelineView(.periodic(from: started, by: 1)) { timeline in
          Text(Clock.digits(timeline.date.timeIntervalSince(started)))
            .font(.system(size: 54, weight: .semibold, design: .rounded))
            .monospacedDigit()
            .accessibilityLabel("录音时长")
            .accessibilityValue(Clock.digits(timeline.date.timeIntervalSince(started)))
        }
        Label("录音中", systemImage: "circle.fill")
          .font(Ink.meta)
          .foregroundStyle(Ink.danger)
        Button {
          capture.finish(studio)
        } label: {
          Image(systemName: "stop.fill")
            .font(.system(size: 23, weight: .semibold))
            .frame(width: 64, height: 64)
            .foregroundStyle(Color.white)
            .background(Color(red: 0.83, green: 0.17, blue: 0.22), in: Circle())
        }
        .buttonStyle(.plain)
        .padding(.top, 8)
        .accessibilityLabel("停止录音并保存")
      }
    case .processing:
      VStack(spacing: 15) {
        ProgressView().tint(Ink.text)
        Text("正在转写并保存").font(Ink.body)
      }
    case .saved:
      VStack(spacing: 15) {
        Image(systemName: "checkmark.circle.fill")
          .font(.system(size: 38))
          .foregroundStyle(Ink.live)
        Text("已存入想法暂存").font(Ink.body)
      }
    case .failed(let message):
      VStack(spacing: 14) {
        Text(message)
          .font(Ink.body)
          .multilineTextAlignment(.center)
        if capture.hasRecording {
          Button("重试转写") { capture.retry(studio) }
            .buttonStyle(.borderedProminent)
            .tint(Ink.text)
            .foregroundStyle(Ink.bg)
          HStack(spacing: 20) {
            Button("试听录音") { capture.play() }
            Button("舍弃", role: .destructive) { confirmDiscard = true }
          }
          .font(Ink.meta)
        } else if capture.micDenied, let settings = URL(string: UIApplication.openSettingsURLString) {
          Button("打开设置") { openURL(settings) }
            .buttonStyle(.bordered)
        } else {
          Button("重试录音") { Task { await capture.open() } }
            .buttonStyle(.bordered)
        }
      }
    }
  }
}

@MainActor @Observable private final class VoiceIdeaSession {
  enum Phase: Equatable {
    case preparing, recording(Date), processing, saved, failed(String)
  }

  private(set) var phase = Phase.preparing
  private(set) var micDenied = false
  var isRecording: Bool { if case .recording = phase { true } else { false } }
  var hasRecording: Bool { pendingURL != nil }

  private var pendingURL: URL?
  private var started = Date()
  @ObservationIgnored private var recorder: AVAudioRecorder?
  @ObservationIgnored private var player: AVAudioPlayer?
  @ObservationIgnored private var work: Task<Void, Never>?
  @ObservationIgnored private var backgroundTask = UIBackgroundTaskIdentifier.invalid

  func open() async {
    phase = .preparing
    do {
      let folder = try recordingFolder()
      if let draft = try FileManager.default.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: [.creationDateKey], options: .skipsHiddenFiles
      ).first(where: { $0.pathExtension == "m4a" }) {
        pendingURL = draft
        started = (try? draft.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? Date()
        phase = .failed("还有一段未保存的录音")
        return
      }
      let granted = await AVAudioApplication.requestRecordPermission()
      guard !Task.isCancelled else { return }
      micDenied = !granted
      guard granted else {
        phase = .failed("请在设置中允许 SELF OS 使用麦克风")
        return
      }

      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
      try session.setActive(true)
      let audio = folder.appendingPathComponent(UUID().uuidString.lowercased() + ".m4a")
      let recorder = try AVAudioRecorder(url: audio, settings: [
        AVFormatIDKey: kAudioFormatMPEG4AAC,
        AVSampleRateKey: 44_100,
        AVNumberOfChannelsKey: 1,
        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
      ])
      guard recorder.record() else {
        try? FileManager.default.removeItem(at: audio)
        throw VoiceIdeaError.microphone
      }
      self.recorder = recorder
      pendingURL = audio
      started = Date()
      phase = .recording(started)
      UIImpactFeedbackGenerator(style: .soft).impactOccurred()
    } catch {
      deactivateAudio()
      phase = .failed("无法开始录音，请检查麦克风后重试")
    }
  }

  func finish(_ studio: Studio) {
    guard isRecording else { return }
    recorder?.stop()
    recorder = nil
    deactivateAudio()
    retry(studio)
  }

  func retry(_ studio: Studio) {
    guard let audio = pendingURL, work == nil else { return }
    if let player {
      player.stop()
      self.player = nil
      deactivateAudio()
    }
    phase = .processing
    backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Voice idea") { [weak self] in
      self?.work?.cancel()
      self?.endBackgroundTask()
    }
    work = Task {
      defer {
        work = nil
        endBackgroundTask()
      }
      do {
        let id = audio.deletingPathExtension().lastPathComponent
        // A process exit after the outbox write can leave its audio file behind.
        if try await studio.store.record(type: "idea", id: id) == nil {
          let text = try await VoiceIdeaTranscription.text(from: audio)
          let cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
          guard !cleaned.isEmpty else { throw VoiceIdeaError.empty }
          try Task.checkCancellation()
          guard await studio.save("idea", [
            "body": .string(cleaned), "day": .string(BusinessDate.day(started)), "status": .string("pending"),
          ], id: id) != nil else { throw VoiceIdeaError.save }
        }
        try? FileManager.default.removeItem(at: audio)
        pendingURL = nil
        phase = .saved
        UINotificationFeedbackGenerator().notificationOccurred(.success)
      } catch {
        let detail = (error as? VoiceIdeaError)?.message ?? "转写中断"
        phase = .failed(detail + "。录音已保存在本机。")
      }
    }
  }

  func play() {
    do {
      guard let pendingURL else { return }
      player?.stop()
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback, mode: .spokenAudio)
      try session.setActive(true)
      let player = try AVAudioPlayer(contentsOf: pendingURL)
      guard player.play() else { throw VoiceIdeaError.empty }
      self.player = player
    } catch {
      deactivateAudio()
      phase = .failed("无法试听这段录音")
    }
  }

  func discard() {
    close()
    if let pendingURL { try? FileManager.default.removeItem(at: pendingURL) }
    pendingURL = nil
  }

  func close() {
    if recorder != nil || player != nil {
      recorder?.stop()
      player?.stop()
      recorder = nil
      player = nil
      deactivateAudio()
    }
  }

  private func recordingFolder() throws -> URL {
    let demo = ProcessInfo.processInfo.environment["STUDIO_DEMO"] != nil
    var folder = URL.applicationSupportDirectory.appendingPathComponent(
      demo ? "DemoVoiceIdeas" : "PendingVoiceIdeas", isDirectory: true)
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    var resources = URLResourceValues()
    resources.isExcludedFromBackup = true
    try folder.setResourceValues(resources)
    return folder
  }

  private func deactivateAudio() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func endBackgroundTask() {
    guard backgroundTask != .invalid else { return }
    UIApplication.shared.endBackgroundTask(backgroundTask)
    backgroundTask = .invalid
  }
}

private enum VoiceIdeaError: Error {
  case microphone, unavailable, permission, empty, save
  var message: String {
    switch self {
    case .microphone: "无法打开麦克风"
    case .unavailable: "本机暂时无法识别中文语音"
    case .permission: "请在设置中允许语音识别"
    case .empty: "没有识别到语音"
    case .save: "文字暂时无法保存"
    }
  }
}

private enum VoiceIdeaTranscription {
  private static var locale: Locale {
    Locale(identifier: Locale.current.language.script?.identifier == "Hant" ? "zh-TW" : "zh-CN")
  }

  static func text(from audio: URL) async throws -> String {
    if #available(iOS 26, *) {
      if SpeechTranscriber.isAvailable,
        let language = await SpeechTranscriber.supportedLocale(equivalentTo: locale)
      {
        let module = SpeechTranscriber(locale: language, preset: .transcription)
        return try await modern(audio, using: module, text: { $0.text })
      }
      if let language = await DictationTranscriber.supportedLocale(equivalentTo: locale) {
        let module = DictationTranscriber(locale: language, preset: .longDictation)
        return try await modern(audio, using: module, text: { $0.text })
      }
    }
    return try await legacy(audio)
  }

  @available(iOS 26, *)
  private static func modern<Module: SpeechModule>(
    _ audio: URL, using module: Module, text: (Module.Result) -> AttributedString
  ) async throws -> String {
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [module]) {
      try await request.downloadAndInstall()
    }
    let file = try AVAudioFile(forReading: audio)
    let analyzer = SpeechAnalyzer(modules: [module])
    do {
      try await analyzer.start(inputAudioFile: file, finishAfterFile: true)
      var transcript = ""
      for try await result in module.results where result.isFinal {
        transcript.append(contentsOf: text(result).characters)
      }
      try Task.checkCancellation()
      return transcript
    } catch {
      await analyzer.cancelAndFinishNow()
      throw error
    }
  }

  private static func legacy(_ audio: URL) async throws -> String {
    let authorized = await withCheckedContinuation { continuation in
      SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
    }
    guard authorized else { throw VoiceIdeaError.permission }
    guard let recognizer = SFSpeechRecognizer(locale: locale), recognizer.supportsOnDeviceRecognition else {
      throw VoiceIdeaError.unavailable
    }
    let request = SFSpeechURLRecognitionRequest(url: audio)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false
    request.addsPunctuation = true
    let (results, continuation) = AsyncThrowingStream<String, Error>.makeStream()
    let recognition = recognizer.recognitionTask(with: request) { result, error in
      if let result, result.isFinal {
        continuation.yield(result.bestTranscription.formattedString)
        continuation.finish()
      } else if let error {
        continuation.finish(throwing: error)
      }
    }
    defer { recognition.cancel() }
    for try await text in results { return text }
    throw CancellationError()
  }
}
