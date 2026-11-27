import AppKit
import WebKit

private final class SelfOSWebView: WKWebView {
    private(set) var lastLeftMouseDown: NSEvent?

    override func mouseDown(with event: NSEvent) {
        lastLeftMouseDown = event
        super.mouseDown(with: event)
    }
}

private final class WeakScriptHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

extension OriginKey {
    init?(securityOrigin: WKSecurityOrigin) {
        self.init(
            protocolScheme: securityOrigin.protocol,
            host: securityOrigin.host,
            port: securityOrigin.port
        )
    }
}

enum SavePanelChoice {
    case save(Result<ExportDestination, Error>)
    case cancel
}

@MainActor
final class ExportSavePanelDelegate: NSObject, NSOpenSavePanelDelegate {
    private var selection: Result<ExportDestination, Error>?

    func panel(_ sender: Any, userEnteredFilename filename: String, confirmed: Bool) -> String? {
        if confirmed {
            selection = (sender as? NSSavePanel)?.directoryURL.map { directory in
                Result { try ExportDestination(directory.appendingPathComponent(filename)) }
            }
        }
        return filename
    }

    func destination(for url: URL) throws -> ExportDestination {
        guard let selection else { throw CocoaError(.fileWriteFileExists) }
        let destination = try selection.get()
        let parent = url.deletingLastPathComponent().resolvingSymlinksInPath()
        guard destination.url.path == parent.appendingPathComponent(url.lastPathComponent).path else {
            throw CocoaError(.fileWriteFileExists, userInfo: [NSURLErrorKey: url])
        }
        return destination
    }
}

enum SaveFailureChoice {
    case retry
    case discard
}

@MainActor
final class SelfOSWindowController: NSObject, NSWindowDelegate, NSMenuItemValidation, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    private static let overrideDefaultsKey = "SelfOSEndpointOverride"
    private static let themeDefaultsKey = "SelfOSLastTheme"
    private static let darkSurface = NSColor(srgbRed: 0x18 / 255.0, green: 0x18 / 255.0, blue: 0x18 / 255.0, alpha: 1)
    private static let lightSurface = NSColor(srgbRed: 0xf7 / 255.0, green: 0xf7 / 255.0, blue: 0xf6 / 255.0, alpha: 1)

    let window: NSWindow
    let webView: WKWebView
    let exportStaging: ExportStagingManager?
    var endpointOverrideForTesting: URL?
    var wechatBridgeOrigin: OriginKey = SelfOSEndpoint.wechatBridgeOrigin
    var externalURLOpener: (URL) -> Void = { url in SelfOSWindowController.openExternalSafely(url) }
    var savePanelHandler: ((StagedExport, @escaping (SavePanelChoice) -> Void) -> Void)?
    var saveFailureHandler: ((Error, StagedExport, @escaping (SaveFailureChoice) -> Void) -> Void)?

    private let errorOverlay = NSView()
    private let errorMessageField = NSTextField(labelWithString: "")
    private var activeDownloads: [ObjectIdentifier: (download: WKDownload, staged: StagedExport)] = [:]
    private var pendingSaveQueue: [StagedExport] = []
    private var isPresentingSavePanel = false

    init(
        websiteDataStore: WKWebsiteDataStore? = nil,
        exportBaseRootDir: URL? = nil
    ) {
        let initialTheme = UserDefaults.standard.string(forKey: Self.themeDefaultsKey) ?? "dark"
        let isLight = initialTheme == "light"

        let contentRect = NSRect(x: 0, y: 0, width: 1160, height: 740)
        let win = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        win.title = "SELF OS"
        win.titleVisibility = .hidden
        win.titlebarAppearsTransparent = true
        win.titlebarSeparatorStyle = .none
        win.toolbar = NSToolbar(identifier: "SelfOSToolbar")
        win.toolbarStyle = .unifiedCompact
        win.minSize = NSSize(width: 780, height: 520)
        let initialAppearance = NSAppearance(named: isLight ? .aqua : .darkAqua)
        win.backgroundColor = isLight ? Self.lightSurface : Self.darkSurface
        win.appearance = initialAppearance
        NSApp?.appearance = initialAppearance
        win.isReleasedWhenClosed = false
        win.collectionBehavior = [.fullScreenPrimary]
        if !win.setFrameUsingName("SelfOSMainWindow") {
            win.center()
        }
        win.setFrameAutosaveName("SelfOSMainWindow")

        let config = WKWebViewConfiguration()
        config.websiteDataStore = websiteDataStore ?? .default()
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true

        let web = SelfOSWebView(frame: contentRect, configuration: config)
        web.setValue(false, forKey: "drawsBackground")
        web.allowsBackForwardNavigationGestures = true
        web.allowsMagnification = true
        #if DEBUG
        if #available(macOS 13.3, *) {
            web.isInspectable = true
        }
        #endif

        self.window = win
        self.webView = web
        self.exportStaging = try? ExportStagingManager(baseRootDir: exportBaseRootDir)
        super.init()

        let shellMarkerJS = "document.documentElement.setAttribute('data-shell', 'macos');"
        config.userContentController.addUserScript(
            WKUserScript(source: shellMarkerJS, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )

        let shellBridgeJS = """
        (function() {
          function reportTheme() {
            var t = document.documentElement.getAttribute('data-theme') || 'dark';
            if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.selfOSTheme) {
              window.webkit.messageHandlers.selfOSTheme.postMessage(t);
            }
          }
          reportTheme();
          new MutationObserver(reportTheme).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
          });

          document.addEventListener('mousedown', function(e) {
            if (e.button !== 0) return;
            var target = e.target;
            if (!(target instanceof Element)) return;
            if (!target.closest('.macos-drag-bar')) return;
            if (target.closest('button, a, input, select, textarea, [draggable="true"], [role="button"]')) return;
            var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.selfOSShell;
            if (!handler) return;
            handler.postMessage(e.detail === 2 ? 'zoomWindow' : 'dragWindow');
          });
        })();
        """
        let weakSelf = WeakScriptHandler(self)
        config.userContentController.add(weakSelf, name: "selfOSTheme")
        config.userContentController.add(weakSelf, name: "selfOSShell")
        config.userContentController.addUserScript(
            WKUserScript(source: shellBridgeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )

        win.delegate = self
        web.navigationDelegate = self
        web.uiDelegate = self

        let container = NSView(frame: contentRect)
        container.autoresizingMask = [.width, .height]
        web.frame = container.bounds
        web.autoresizingMask = [.width, .height]
        container.addSubview(web)

        setupErrorOverlay(in: container)
        win.contentView = container
    }

    // MARK: - Endpoint Configuration

    var currentEndpointURL: URL? {
        if let testURL = endpointOverrideForTesting {
            return testURL
        }
        if let override = UserDefaults.standard.string(forKey: Self.overrideDefaultsKey),
           let url = SelfOSEndpoint.normalize(override) {
            return url
        }
        if let bundled = Bundle.main.object(forInfoDictionaryKey: "CouncilEndpoint") as? String,
           let url = SelfOSEndpoint.normalize(bundled) {
            return url
        }
        return nil
    }

    var appOrigin: OriginKey? {
        guard let url = currentEndpointURL else { return nil }
        return OriginKey(url: url)
    }

    // MARK: - Window, Menu Validation & Actions

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        switch menuItem.action {
        case #selector(goBack):
            return webView.canGoBack
        case #selector(goForward):
            return webView.canGoForward
        default:
            return true
        }
    }

    func showAndLoadIfNeeded() {
        window.makeKeyAndOrderFront(nil)
        if webView.url == nil {
            loadHome()
        }
    }

    func loadHome() {
        guard let url = currentEndpointURL else {
            showError("尚未配置 SELF OS 服务地址。请点击下方「连接设置」填入你的 HTTPS 地址。")
            return
        }
        hideError()
        webView.load(URLRequest(url: url))
    }

    @objc func reloadPage() {
        hideError()
        if webView.url != nil {
            webView.reload()
        } else {
            loadHome()
        }
    }

    @objc func reloadIgnoringCache() {
        hideError()
        if webView.url != nil {
            webView.reloadFromOrigin()
        } else {
            loadHome()
        }
    }

    @objc func goBack() {
        if webView.canGoBack { webView.goBack() }
    }

    @objc func goForward() {
        if webView.canGoForward { webView.goForward() }
    }

    @objc func zoomIn() {
        webView.pageZoom = min(2.0, (webView.pageZoom * 100 + 10).rounded() / 100)
    }

    @objc func zoomOut() {
        webView.pageZoom = max(0.7, (webView.pageZoom * 100 - 10).rounded() / 100)
    }

    @objc func resetZoom() {
        webView.pageZoom = 1.0
    }

    @objc func toggleSidebar() {
        webView.evaluateJavaScript("window.dispatchEvent(new Event('selfos-toggle-sidebar'));", completionHandler: nil)
    }

    private func syncFullScreenState(_ isFullScreen: Bool) {
        webView.evaluateJavaScript(
            "document.documentElement.setAttribute('data-fullscreen', '\(isFullScreen ? "true" : "false")');",
            completionHandler: nil
        )
    }

    func window(
        _ window: NSWindow,
        willUseFullScreenPresentationOptions proposedOptions: NSApplication.PresentationOptions
    ) -> NSApplication.PresentationOptions {
        [.fullScreen, .autoHideMenuBar, .autoHideToolbar]
    }

    func windowWillEnterFullScreen(_ notification: Notification) {
        window.toolbar?.isVisible = false
        syncFullScreenState(true)
    }

    func windowDidEnterFullScreen(_ notification: Notification) {
        window.toolbar?.isVisible = false
        syncFullScreenState(true)
    }

    func windowWillExitFullScreen(_ notification: Notification) {
        window.toolbar?.isVisible = true
        syncFullScreenState(false)
    }

    func windowDidExitFullScreen(_ notification: Notification) {
        window.toolbar?.isVisible = true
        syncFullScreenState(false)
    }

    @objc func promptEndpointSettings() {
        let alert = NSAlert()
        alert.messageText = "SELF OS 连接设置"
        alert.informativeText = "请输入正式 HTTPS 站点地址（不支持内嵌账号密码，留空恢复构建时默认地址）："
        alert.alertStyle = .informational
        alert.addButton(withTitle: "保存并重新加载")
        alert.addButton(withTitle: "取消")

        let input = NSTextField(frame: NSRect(x: 0, y: 0, width: 340, height: 24))
        input.placeholderString = "https://example.com:9443"
        input.stringValue = UserDefaults.standard.string(forKey: Self.overrideDefaultsKey)
            ?? (Bundle.main.object(forInfoDictionaryKey: "CouncilEndpoint") as? String ?? "")
        alert.accessoryView = input

        let response = alert.runModal()
        guard response == .alertFirstButtonReturn else { return }
        let raw = input.stringValue.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty {
            UserDefaults.standard.removeObject(forKey: Self.overrideDefaultsKey)
            loadHome()
            return
        }
        guard let validURL = SelfOSEndpoint.normalize(raw) else {
            let err = NSAlert()
            err.messageText = "地址格式无效"
            err.informativeText = "远程站点必须使用 https:// 且不得包含内嵌凭证（仅本机调试允许 http://127.0.0.1 或 localhost）。"
            err.runModal()
            return
        }
        UserDefaults.standard.set(validURL.absoluteString, forKey: Self.overrideDefaultsKey)
        loadHome()
    }

    // MARK: - Theme Synchronization

    private func applyTheme(_ theme: String) {
        let normalized = theme == "light" ? "light" : "dark"
        UserDefaults.standard.set(normalized, forKey: Self.themeDefaultsKey)
        let isLight = normalized == "light"
        let appearance = NSAppearance(named: isLight ? .aqua : .darkAqua)
        window.backgroundColor = isLight ? Self.lightSurface : Self.darkSurface
        window.appearance = appearance
        NSApp?.appearance = appearance
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              let senderOrigin = OriginKey(securityOrigin: message.frameInfo.securityOrigin),
              senderOrigin == appOrigin,
              let action = message.body as? String
        else { return }

        switch message.name {
        case "selfOSTheme":
            applyTheme(action)
        case "selfOSShell":
            if action == "dragWindow", let ev = (webView as? SelfOSWebView)?.lastLeftMouseDown {
                window.performDrag(with: ev)
            } else if action == "zoomWindow" {
                window.performZoom(nil)
            }
        default:
            break
        }
    }

    // MARK: - Offline / Connection Error Overlay

    private func setupErrorOverlay(in parent: NSView) {
        errorOverlay.frame = parent.bounds
        errorOverlay.autoresizingMask = [.width, .height]
        errorOverlay.wantsLayer = true
        errorOverlay.layer?.backgroundColor = Self.darkSurface.cgColor
        errorOverlay.isHidden = true

        let title = NSTextField(labelWithString: "无法连接 SELF OS")
        title.font = .systemFont(ofSize: 16, weight: .semibold)
        title.textColor = NSColor(white: 0.96, alpha: 1)

        errorMessageField.font = .systemFont(ofSize: 13)
        errorMessageField.textColor = NSColor(white: 0.62, alpha: 1)
        errorMessageField.alignment = .center
        errorMessageField.maximumNumberOfLines = 3
        errorMessageField.preferredMaxLayoutWidth = 420

        let retryBtn = NSButton(title: "重试连接", target: self, action: #selector(reloadPage))
        retryBtn.bezelStyle = .rounded
        retryBtn.keyEquivalent = "\r"

        let settingsBtn = NSButton(title: "连接设置…", target: self, action: #selector(promptEndpointSettings))
        settingsBtn.bezelStyle = .rounded

        let buttons = NSStackView(views: [retryBtn, settingsBtn])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [title, errorMessageField, buttons])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false

        errorOverlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: errorOverlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: errorOverlay.centerYAnchor),
            errorMessageField.widthAnchor.constraint(lessThanOrEqualToConstant: 440),
        ])
        parent.addSubview(errorOverlay)
    }

    private func showError(_ text: String) {
        errorMessageField.stringValue = text
        errorOverlay.isHidden = false
    }

    private func hideError() {
        errorOverlay.isHidden = true
    }

    // MARK: - Navigation & Security Policy

    private static func openExternalSafely(_ url: URL) {
        guard SelfOSSecurityPolicy.isExternalSafeScheme(url) else { return }
        NSWorkspace.shared.open(url)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        preferences: WKWebpagePreferences,
        decisionHandler: @escaping (WKNavigationActionPolicy, WKWebpagePreferences) -> Void
    ) {
        switch navigationOutcome(for: navigationAction) {
        case .allow:
            decisionHandler(.allow, preferences)
        case .download:
            decisionHandler(.download, preferences)
        case .loadInCurrentWebView(let url):
            decisionHandler(.cancel, preferences)
            webView.load(URLRequest(url: url))
        case .openExternal(let url):
            decisionHandler(.cancel, preferences)
            externalURLOpener(url)
        case .cancel:
            decisionHandler(.cancel, preferences)
        }
    }

    private func navigationOutcome(for navigationAction: WKNavigationAction) -> NavigationOutcome {
        SelfOSSecurityPolicy.decideAction(
            appOrigin: appOrigin,
            wechatOrigin: wechatBridgeOrigin,
            url: navigationAction.request.url,
            shouldPerformDownload: navigationAction.shouldPerformDownload,
            sourceIsMainFrame: navigationAction.sourceFrame.isMainFrame,
            sourceOrigin: OriginKey(securityOrigin: navigationAction.sourceFrame.securityOrigin),
            targetFrameExists: navigationAction.targetFrame != nil,
            targetIsMainFrame: navigationAction.targetFrame?.isMainFrame ?? true,
            isLinkActivated: navigationAction.navigationType == .linkActivated
        )

    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        let outcome = SelfOSSecurityPolicy.decideResponse(
            appOrigin: appOrigin,
            wechatOrigin: wechatBridgeOrigin,
            responseURL: navigationResponse.response.url,
            isForMainFrame: navigationResponse.isForMainFrame,
            canShowMIMEType: navigationResponse.canShowMIMEType
        )

        switch outcome {
        case .allow:
            decisionHandler(.allow)
        case .download:
            decisionHandler(.download)
        case .cancel:
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        hideError()
        syncFullScreenState(window.styleMask.contains(.fullScreen))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled { return }
        if nsError.domain == "WebKitErrorDomain" && (nsError.code == 102 || nsError.code == 104) { return }
        showError("请检查网络连接或服务状态（\(nsError.localizedDescription)）。")
    }

    // MARK: - UI Delegate (External Windows, File Upload, JS Dialogs)

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        switch navigationOutcome(for: navigationAction) {
        case .loadInCurrentWebView(let url):
            webView.load(URLRequest(url: url))
        case .openExternal(let url):
            externalURLOpener(url)
        default:
            break
        }
        return nil
    }

    func webView(
        _ webView: WKWebView,
        runOpenPanelWith parameters: WKOpenPanelParameters,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping ([URL]?) -> Void
    ) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "SELF OS"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window) { _ in completionHandler() }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "SELF OS"
        alert.informativeText = message
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn)
        }
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = NSAlert()
        alert.messageText = "SELF OS"
        alert.informativeText = prompt
        alert.addButton(withTitle: "确认")
        alert.addButton(withTitle: "取消")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 280, height: 24))
        field.stringValue = defaultText ?? ""
        alert.accessoryView = field
        alert.beginSheetModal(for: window) { resp in
            completionHandler(resp == .alertFirstButtonReturn ? field.stringValue : nil)
        }
    }

    // MARK: - Downloads (Same-Origin Enforcement + Cross-Volume Safe Save + Retry)

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(
        _ download: WKDownload,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        decisionHandler: @escaping (WKDownload.RedirectPolicy) -> Void
    ) {
        if SelfOSSecurityPolicy.allowDownloadRedirect(appOrigin: appOrigin, newRequestURL: request.url) {
            decisionHandler(.allow)
        } else {
            decisionHandler(.cancel)
        }
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        guard SelfOSSecurityPolicy.allowDownloadDestination(appOrigin: appOrigin, responseURL: response.url),
              let staging = exportStaging,
              let staged = try? staging.createStagedExport(suggestedFilename: suggestedFilename)
        else {
            completionHandler(nil)
            return
        }
        activeDownloads[ObjectIdentifier(download)] = (download: download, staged: staged)
        completionHandler(staged.tempFile)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let item = activeDownloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        enqueueSavePanel(for: item.staged)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if let item = activeDownloads.removeValue(forKey: ObjectIdentifier(download)) {
            exportStaging?.discardStagedExport(item.staged)
        }
    }

    private func enqueueSavePanel(for staged: StagedExport) {
        pendingSaveQueue.append(staged)
        presentNextSavePanelIfIdle()
    }

    private func presentNextSavePanelIfIdle() {
        guard !isPresentingSavePanel, !pendingSaveQueue.isEmpty else { return }
        isPresentingSavePanel = true
        let staged = pendingSaveQueue.removeFirst()
        presentSavePanel(for: staged)
    }

    private func presentSavePanel(for staged: StagedExport) {
        guard let staging = exportStaging else {
            isPresentingSavePanel = false
            presentNextSavePanelIfIdle()
            return
        }

        let commitChoice: (SavePanelChoice) -> Void = { [weak self] choice in
            guard let self else { return }
            switch choice {
            case .cancel:
                staging.discardStagedExport(staged)
                self.isPresentingSavePanel = false
                self.presentNextSavePanelIfIdle()
            case .save(let destination):
                do {
                    try staging.commitStagedExport(staged, to: destination.get())
                    self.isPresentingSavePanel = false
                    self.presentNextSavePanelIfIdle()
                } catch {
                    let handleFailureDecision: (SaveFailureChoice) -> Void = { [weak self] retryDecision in
                        guard let self else { return }
                        switch retryDecision {
                        case .retry:
                            self.presentSavePanel(for: staged)
                        case .discard:
                            staging.discardStagedExport(staged)
                            self.isPresentingSavePanel = false
                            self.presentNextSavePanelIfIdle()
                        }
                    }

                    if let customFailure = self.saveFailureHandler {
                        customFailure(error, staged, handleFailureDecision)
                        return
                    }

                    let retryAlert = NSAlert()
                    retryAlert.alertStyle = .warning
                    retryAlert.messageText = "保存导出文件失败"
                    retryAlert.informativeText = "\(error.localizedDescription)\n\n本次导出的临时文件仍已保留，你可以换一个目录重试保存。"
                    retryAlert.addButton(withTitle: "重新选择保存位置")
                    retryAlert.addButton(withTitle: "放弃本次导出")

                    let onAlert: (NSApplication.ModalResponse) -> Void = { resp in
                        handleFailureDecision(resp == .alertFirstButtonReturn ? .retry : .discard)
                    }
                    if self.window.isVisible {
                        retryAlert.beginSheetModal(for: self.window, completionHandler: onAlert)
                    } else {
                        onAlert(retryAlert.runModal())
                    }
                }
            }
        }

        if let customPanel = savePanelHandler {
            customPanel(staged, commitChoice)
            return
        }

        let savePanel = NSSavePanel()
        savePanel.nameFieldStringValue = staged.suggestedFilename
        savePanel.canCreateDirectories = true
        savePanel.isExtensionHidden = false
        let panelDelegate = ExportSavePanelDelegate()
        savePanel.delegate = panelDelegate

        let onPanel: (NSApplication.ModalResponse) -> Void = { result in
            if result == .OK, let destURL = savePanel.url {
                commitChoice(.save(Result { try panelDelegate.destination(for: destURL) }))
            } else {
                commitChoice(.cancel)
            }
        }

        if window.isVisible {
            savePanel.beginSheetModal(for: window, completionHandler: onPanel)
        } else {
            onPanel(savePanel.runModal())
        }
    }

    func cleanupTemporaryDownloads() {
        for item in activeDownloads.values {
            item.download.cancel { _ in }
        }
        activeDownloads.removeAll()
        pendingSaveQueue.removeAll()
        exportStaging?.cleanupAll()
    }
}

@MainActor
final class SelfOSAppDelegate: NSObject, NSApplicationDelegate {
    private(set) var mainController: SelfOSWindowController?

    func installController(_ controller: SelfOSWindowController) {
        self.mainController = controller
        setupMainMenu(controller: controller)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = SelfOSWindowController()
        installController(controller)
        controller.showAndLoadIfNeeded()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !flag {
            mainController?.showAndLoadIfNeeded()
        }
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        false
    }

    func applicationWillTerminate(_ notification: Notification) {
        mainController?.cleanupTemporaryDownloads()
    }

    private func setupMainMenu(controller: SelfOSWindowController) {
        let mainMenu = NSMenu()

        // 1. Application Menu
        let appMenuItem = NSMenuItem(title: "SELF OS", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "SELF OS")
        appMenu.addItem(withTitle: "关于 SELF OS", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        let settingsItem = NSMenuItem(title: "连接设置…", action: #selector(SelfOSWindowController.promptEndpointSettings), keyEquivalent: ",")
        settingsItem.target = controller
        appMenu.addItem(settingsItem)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 SELF OS", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 SELF OS", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        mainMenu.addItem(appMenuItem)

        // 2. Edit Menu
        let editMenuItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        mainMenu.addItem(editMenuItem)

        // 3. View Menu
        let viewMenuItem = NSMenuItem(title: "显示", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "显示")
        let toggleSide = NSMenuItem(title: "切换侧边栏", action: #selector(SelfOSWindowController.toggleSidebar), keyEquivalent: "S")
        toggleSide.keyEquivalentModifierMask = [.command, .shift]
        toggleSide.target = controller
        viewMenu.addItem(toggleSide)
        viewMenu.addItem(.separator())
        let reload = NSMenuItem(title: "重新加载页面", action: #selector(SelfOSWindowController.reloadPage), keyEquivalent: "r")
        reload.target = controller
        viewMenu.addItem(reload)
        let forceReload = NSMenuItem(title: "忽略缓存重新加载", action: #selector(SelfOSWindowController.reloadIgnoringCache), keyEquivalent: "R")
        forceReload.keyEquivalentModifierMask = [.command, .shift]
        forceReload.target = controller
        viewMenu.addItem(forceReload)
        viewMenu.addItem(.separator())
        let back = NSMenuItem(title: "后退", action: #selector(SelfOSWindowController.goBack), keyEquivalent: "[")
        back.target = controller
        viewMenu.addItem(back)
        let forward = NSMenuItem(title: "前进", action: #selector(SelfOSWindowController.goForward), keyEquivalent: "]")
        forward.target = controller
        viewMenu.addItem(forward)
        viewMenu.addItem(.separator())
        let actualSize = NSMenuItem(title: "实际大小", action: #selector(SelfOSWindowController.resetZoom), keyEquivalent: "0")
        actualSize.target = controller
        viewMenu.addItem(actualSize)
        let zoomIn = NSMenuItem(title: "放大", action: #selector(SelfOSWindowController.zoomIn), keyEquivalent: "=")
        zoomIn.target = controller
        viewMenu.addItem(zoomIn)
        let zoomOut = NSMenuItem(title: "缩小", action: #selector(SelfOSWindowController.zoomOut), keyEquivalent: "-")
        zoomOut.target = controller
        viewMenu.addItem(zoomOut)
        viewMenu.addItem(.separator())
        let fullScreen = NSMenuItem(title: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        fullScreen.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(fullScreen)
        viewMenuItem.submenu = viewMenu
        mainMenu.addItem(viewMenuItem)

        // 4. Window Menu
        let windowMenuItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "窗口")
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowMenu.addItem(.separator())
        windowMenu.addItem(withTitle: "前置全部窗口", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        mainMenu.addItem(windowMenuItem)
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = mainMenu
    }
}

#if !SELFOS_TESTING_HARNESS
@main
enum SelfOSMacMain {
    static func main() {
        let app = NSApplication.shared
        let delegate = SelfOSAppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }
}
#endif
