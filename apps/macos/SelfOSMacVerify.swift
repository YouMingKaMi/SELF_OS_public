import AppKit
import Foundation
import WebKit

private func check(_ condition: @autoclosure () -> Bool, _ message: String, file: StaticString = #file, line: UInt = #line) {
    if !condition() {
        fputs("FAIL [\(file):\(line)]: \(message)\n", stderr)
        exit(1)
    }
}

@MainActor
private func waitUntil(timeout: TimeInterval = 8.0, _ predicate: () -> Bool) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
        if predicate() { return true }
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
    return predicate()
}

@MainActor
private func sleepRunLoop(_ seconds: TimeInterval) {
    let deadline = Date().addingTimeInterval(seconds)
    while Date() < deadline {
        RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02))
    }
}

@MainActor
private func evalJS(_ webView: WKWebView, _ script: String) -> Any? {
    var done = false
    var value: Any?
    var err: Error?
    webView.evaluateJavaScript(script) { res, e in
        value = res
        err = e
        done = true
    }
    _ = waitUntil(timeout: 5.0) { done }
    if let err {
        fputs("JS Error for `\(script)`: \(err)\n", stderr)
    }
    return value
}

// MARK: - 1. Pure Policy & Staging Unit Checks

private func runPurePolicyAndStagingChecks(externalVolumeDir: URL?) throws {
    // Endpoint normalization & credential rejection
    check(SelfOSEndpoint.normalize("example.com:9443")?.absoluteString == "https://example.com:9443", "normalize bare host")
    check(SelfOSEndpoint.normalize("https://user:pass@example.com:9443") == nil, "reject embedded credentials")
    check(SelfOSEndpoint.normalize("http://example.com:9443") == nil, "reject plain HTTP on remote host")
    check(SelfOSEndpoint.normalize("http://127.0.0.1:8900/some/path?x=1")?.absoluteString == "http://127.0.0.1:8900", "allow loopback HTTP and strip path")

    let app = OriginKey(scheme: "https", host: "selfos.example", port: 9443)
    let bridge = OriginKey(scheme: "http", host: "127.0.0.1", port: 18766)

    // Prefix spoofing check
    let spoofURL = URL(string: "https://selfos.example.attacker.tld:9443/steal")!
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            wechatOrigin: bridge,
            url: spoofURL,
            shouldPerformDownload: false,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: true
        ) == .openExternal(spoofURL),
        "prefix-spoofed host must not match appOrigin"
    )

    // Blob restrictions
    let goodBlob = URL(string: "blob:https://selfos.example:9443/1234-5678")!
    let evilBlob = URL(string: "blob:https://evil.example/1234-5678")!
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: goodBlob,
            shouldPerformDownload: true,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: false
        ) == .download,
        "trusted main-frame same-origin blob download allowed"
    )
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: goodBlob,
            shouldPerformDownload: true,
            sourceIsMainFrame: false,
            sourceOrigin: bridge,
            targetFrameExists: true,
            targetIsMainFrame: false,
            isLinkActivated: false
        ) == .cancel,
        "subframe must not trigger blob download"
    )
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: evilBlob,
            shouldPerformDownload: true,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: false
        ) == .cancel,
        "cross-origin blob must be cancelled"
    )

    // about: restrictions
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: URL(string: "about:blank"),
            shouldPerformDownload: true,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: false
        ) == .cancel,
        "about:blank download must be cancelled"
    )
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: URL(string: "about:srcdoc"),
            shouldPerformDownload: false,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: false
        ) == .cancel,
        "non-blank about URL must be cancelled"
    )

    // Cross-origin download attribute & redirects
    let evilDownload = URL(string: "https://evil.example/payload.dmg")!
    for targetFrameExists in [true, false] {
        check(
            SelfOSSecurityPolicy.decideAction(
                appOrigin: app, url: evilDownload, shouldPerformDownload: false,
                sourceIsMainFrame: true, sourceOrigin: app, targetFrameExists: targetFrameExists,
                targetIsMainFrame: true, isLinkActivated: false
            ) == .cancel,
            "automatic external navigation must not open the system browser"
        )
    }
    check(
        SelfOSSecurityPolicy.decideAction(
            appOrigin: app,
            url: evilDownload,
            shouldPerformDownload: true,
            sourceIsMainFrame: true,
            sourceOrigin: app,
            targetFrameExists: true,
            targetIsMainFrame: true,
            isLinkActivated: false
        ) == .cancel,
        "cross-origin automatic download must be cancelled"
    )
    check(
        !SelfOSSecurityPolicy.allowDownloadRedirect(appOrigin: app, newRequestURL: evilDownload),
        "cross-origin download redirect must be rejected"
    )
    check(
        SelfOSSecurityPolicy.allowDownloadRedirect(
            appOrigin: app,
            newRequestURL: URL(string: "https://selfos.example:9443/exports/2.json")
        ),
        "same-origin download redirect allowed"
    )
    check(
        SelfOSSecurityPolicy.decideResponse(
            appOrigin: app,
            wechatOrigin: bridge,
            responseURL: URL(string: "http://127.0.0.1:18766/embedded"),
            isForMainFrame: false,
            canShowMIMEType: false
        ) == .cancel,
        "subframe binary response must not enter download flow"
    )

    // Staging permissions, stale dead-PID cleanup, live-PID preservation, and cross-volume commit
    let fm = FileManager.default
    let testRoot = fm.temporaryDirectory.appendingPathComponent("selfos-verify-\(UUID().uuidString)", isDirectory: true)
    defer { try? fm.removeItem(at: testRoot) }
    try fm.createDirectory(at: testRoot, withIntermediateDirectories: true)

    let deadDir = testRoot.appendingPathComponent("pid-424242-dead", isDirectory: true)
    let liveDir = testRoot.appendingPathComponent("pid-434343-live", isDirectory: true)
    try fm.createDirectory(at: deadDir, withIntermediateDirectories: true)
    try fm.createDirectory(at: liveDir, withIntermediateDirectories: true)

    ExportStagingManager.cleanupStaleProcessDirectories(
        in: testRoot,
        currentPID: 100,
        isProcessAlive: { pid in pid == 434343 }
    )
    check(!fm.fileExists(atPath: deadDir.path), "dead PID staging directory removed")
    check(fm.fileExists(atPath: liveDir.path), "live parallel PID staging directory preserved")

    let manager = try ExportStagingManager(baseRootDir: testRoot, pid: 100, cleanupStaleOnInit: false)
    let perms = (try fm.attributesOfItem(atPath: manager.instanceDir.path)[.posixPermissions] as? NSNumber)?.intValue ?? 0
    check(perms == 0o700, "instance staging directory must have 0700 permissions, got \(String(perms, radix: 8))")

    check(ExportStagingManager.sanitizeFilename("../../secret.json") == "secret.json", "path traversal stripped")
    check(ExportStagingManager.sanitizeFilename("..") == "self-os-export.dat", "dot-dot fallback")

    let conflictExport = try manager.createStagedExport(suggestedFilename: "conflict.json")
    let exportBytes = Data("NEW_EXPORT".utf8)
    let competingBytes = Data("KEEP_THIS_FILE".utf8)
    try exportBytes.write(to: conflictExport.tempFile)
    for existed in [false, true] {
        let target = testRoot.appendingPathComponent("conflict-\(existed).json")
        if existed { try Data("PREVIOUS_TARGET".utf8).write(to: target) }
        let approved = try ExportDestination(target)
        try competingBytes.write(to: target, options: .atomic)
        do {
            try manager.commitStagedExport(conflictExport, to: approved)
            check(false, "a new or replaced file may not be overwritten without confirmation")
        } catch {
            let current = try Data(contentsOf: target)
            let staged = try Data(contentsOf: conflictExport.tempFile)
            check(current == competingBytes, "file created or replaced after approval is preserved")
            check(staged == exportBytes, "conflict retains the original export for retry")
        }
    }
    manager.discardStagedExport(conflictExport)

    if let extVol = externalVolumeDir {
        let staged = try manager.createStagedExport(suggestedFilename: "cross-vol.json")
        let expected = Data("{\"crossVolume\":true,\"count\":42}\n".utf8)
        try expected.write(to: staged.tempFile)

        let existingDest = extVol.appendingPathComponent("existing-export.json")
        try Data("OLD_CONTENT".utf8).write(to: existingDest)

        try manager.commitStagedExport(staged, to: ExportDestination(existingDest))
        let saved = try Data(contentsOf: existingDest)
        check(saved == expected, "cross-volume overwrite must write exact new bytes")
        check(!fm.fileExists(atPath: staged.exportDir.path), "staged export cleaned up after cross-volume commit")
        print("SELFOS_CROSS_VOLUME_OK")
    }
}

// MARK: - 2. Real AppKit + WKWebView + WKDownload End-to-End Verification

@MainActor
private func runWebKitAndWindowChecks(
    appURL: URL,
    bridgeURL: URL,
    evilURL: URL,
    externalVolumeDir: URL?
) throws {
    let fm = FileManager.default
    let workDir = fm.temporaryDirectory.appendingPathComponent("selfos-e2e-\(UUID().uuidString)", isDirectory: true)
    try fm.createDirectory(at: workDir, withIntermediateDirectories: true)
    defer { try? fm.removeItem(at: workDir) }

    let stagingRoot = workDir.appendingPathComponent("staging", isDirectory: true)
    let delegate = SelfOSAppDelegate()
    NSApp.delegate = delegate

    let controller = SelfOSWindowController(
        websiteDataStore: .nonPersistent(),
        exportBaseRootDir: stagingRoot
    )
    controller.endpointOverrideForTesting = appURL
    controller.wechatBridgeOrigin = OriginKey(url: bridgeURL)!

    var openedExternal: [URL] = []
    controller.externalURLOpener = { url in
        openedExternal.append(url)
    }
    delegate.installController(controller)
    controller.showAndLoadIfNeeded()

    // 1. Same-origin load + WeChat bridge subframe allowed + evil subframe blocked + theme sync
    let loaded = waitUntil(timeout: 8.0) {
        (evalJS(controller.webView, "document.readyState") as? String) == "complete"
            && (evalJS(controller.webView, "window.__pageReady === true") as? Bool) == true
    }
    check(loaded, "main synthetic page loaded")

    // Give subframes a brief moment to settle
    sleepRunLoop(0.4)
    check(controller.webView.url?.host == appURL.host && controller.webView.url?.port == appURL.port, "stayed on appOrigin")
    check(
        (evalJS(controller.webView, "document.documentElement.getAttribute('data-shell')") as? String) == "macos",
        "data-shell=macos injected at document start"
    )
    check(controller.window.styleMask.contains(.fullSizeContentView), "window uses fullSizeContentView unified chrome")
    check(controller.window.toolbarStyle == .unifiedCompact, "window uses unifiedCompact toolbar style")
    let fsOptions = controller.window(controller.window, willUseFullScreenPresentationOptions: [.fullScreen])
    check(
        fsOptions.contains(.fullScreen) && fsOptions.contains(.autoHideMenuBar) && fsOptions.contains(.autoHideToolbar),
        "full-screen presentation auto-hides menu bar and toolbar"
    )

    // Theme sync message check
    _ = evalJS(controller.webView, "document.documentElement.setAttribute('data-theme', 'light')")
    let lightSynced = waitUntil(timeout: 3.0) {
        controller.window.appearance?.name == .aqua
    }
    check(lightSynced, "light theme synchronized to NSWindow")
    _ = evalJS(controller.webView, "document.documentElement.setAttribute('data-theme', 'dark')")
    let darkSynced = waitUntil(timeout: 3.0) {
        controller.window.appearance?.name == .darkAqua
    }
    check(darkSynced, "dark theme synchronized to NSWindow")

    // 2. External link & target="_blank" handed to externalURLOpener without navigating main frame
    _ = evalJS(controller.webView, "document.getElementById('ext-link').click()")
    _ = evalJS(controller.webView, "document.getElementById('blank-bridge-link').click()")
    let extHandled = waitUntil(timeout: 3.0) { openedExternal.count >= 2 }
    check(extHandled, "external link and target=_blank routed to externalURLOpener")
    check(openedExternal.contains(where: { $0.host == evilURL.host && $0.port == evilURL.port }), "evil link opened externally")
    check(openedExternal.contains(where: { $0.port == bridgeURL.port }), "target=_blank bridge link opened externally")
    check(OriginKey(url: controller.webView.url!) == OriginKey(url: appURL), "main frame did not leave appOrigin")

    // 3. Cross-origin download redirect MUST be rejected before save panel
    var unexpectedRedirectSaveCalled = false
    controller.savePanelHandler = { _, decide in
        unexpectedRedirectSaveCalled = true
        decide(.cancel)
    }
    _ = evalJS(controller.webView, "document.getElementById('redirect-dl').click()")
    sleepRunLoop(0.6)
    check(!unexpectedRedirectSaveCalled, "cross-origin download redirect must never reach save panel")

    // 4. Blob download waiting > 1.2s (exceeding download.ts 1000ms URL.revokeObjectURL) + cross-volume overwrite
    let targetSaveDir = externalVolumeDir ?? workDir
    let overwriteTarget = targetSaveDir.appendingPathComponent("delayed-blob.json")
    try Data("STALE_FILE".utf8).write(to: overwriteTarget)

    var delayedSaved = false
    controller.savePanelHandler = { staged, decide in
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.25) {
            decide(.save(Result { try ExportDestination(overwriteTarget) }))
            delayedSaved = true
        }
    }
    _ = evalJS(controller.webView, "window.triggerBlobDownload('delayed-blob.json', '{\"ok\":1250}')")
    let blobDone = waitUntil(timeout: 6.0) { delayedSaved }
    check(blobDone, "blob download completed after >1.2s panel wait")
    sleepRunLoop(0.1)
    check(
        (try? String(contentsOf: overwriteTarget, encoding: .utf8)) == "{\"ok\":1250}",
        "delayed blob overwrite saved exact bytes across volume"
    )
    check(controller.exportStaging?.trackedExports.isEmpty == true, "staged export cleaned after delayed save")

    // 5. Cancel removes temp export
    var cancelledExportDir: URL?
    var cancelFinished = false
    controller.savePanelHandler = { staged, decide in
        cancelledExportDir = staged.exportDir
        decide(.cancel)
        cancelFinished = true
    }
    _ = evalJS(controller.webView, "window.triggerBlobDownload('cancel-me.md', '# cancelled')")
    _ = waitUntil(timeout: 4.0) { cancelFinished }
    sleepRunLoop(0.1)
    check(cancelledExportDir != nil && !fm.fileExists(atPath: cancelledExportDir!.path), "cancelled export temp dir deleted")

    // 6. Save failure into read-only directory preserves staged export & succeeds on retry
    let readOnlyDir = workDir.appendingPathComponent("readonly", isDirectory: true)
    try fm.createDirectory(at: readOnlyDir, withIntermediateDirectories: true)
    try fm.setAttributes([.posixPermissions: 0o500], ofItemAtPath: readOnlyDir.path)
    defer { try? fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: readOnlyDir.path) }

    let retrySuccessDest = workDir.appendingPathComponent("retried-ok.json")
    var attemptCount = 0
    var sawIntactTempOnFailure = false
    var retryDone = false

    controller.savePanelHandler = { _, decide in
        attemptCount += 1
        if attemptCount == 1 {
            decide(.save(Result { try ExportDestination(readOnlyDir.appendingPathComponent("blocked.json")) }))
        } else {
            decide(.save(Result { try ExportDestination(retrySuccessDest) }))
            retryDone = true
        }
    }
    controller.saveFailureHandler = { _, staged, onRetry in
        sawIntactTempOnFailure = fm.fileExists(atPath: staged.tempFile.path)
        onRetry(.retry)
    }
    _ = evalJS(controller.webView, "window.triggerBlobDownload('retried.json', '{\"retried\":true}')")
    _ = waitUntil(timeout: 5.0) { retryDone }
    sleepRunLoop(0.1)
    check(sawIntactTempOnFailure, "temp export preserved intact after failed write")
    check((try? String(contentsOf: retrySuccessDest, encoding: .utf8)) == "{\"retried\":true}", "retry save wrote exact bytes")
    check(controller.exportStaging?.trackedExports.isEmpty == true, "staged export cleaned after retry success")
    controller.saveFailureHandler = nil

    // 7. Concurrent two exports (second initiated while first save panel is still open) queued & both saved cleanly
    let concDest1 = workDir.appendingPathComponent("conc-1.txt")
    let concDest2 = workDir.appendingPathComponent("conc-2.txt")
    var concSavedCount = 0
    var triggeredSecondWhileFirstOpen = false
    controller.savePanelHandler = { [weak controller] staged, decide in
        if !triggeredSecondWhileFirstOpen, let webView = controller?.webView {
            triggeredSecondWhileFirstOpen = true
            webView.evaluateJavaScript("window.triggerBlobDownload('conc-2.txt', 'SECOND')", completionHandler: nil)
        }
        let dest = staged.suggestedFilename == "conc-1.txt" ? concDest1 : concDest2
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
            decide(.save(Result { try ExportDestination(dest) }))
            concSavedCount += 1
        }
    }
    _ = evalJS(controller.webView, "window.triggerBlobDownload('conc-1.txt', 'FIRST')")
    _ = waitUntil(timeout: 6.0) { concSavedCount == 2 }
    sleepRunLoop(0.1)
    check((try? String(contentsOf: concDest1, encoding: .utf8)) == "FIRST", "first concurrent export saved")
    check((try? String(contentsOf: concDest2, encoding: .utf8)) == "SECOND", "second concurrent export saved")
    check(controller.exportStaging?.trackedExports.isEmpty == true, "no leftover tracked exports after concurrent saves")

    // 8. Window close/reopen, minimize, menu validation (Back/Forward/Force Reload), and input editing
    let viewMenu = NSApp.mainMenu?.item(withTitle: "显示")?.submenu
    let backItem = viewMenu?.item(withTitle: "后退")
    let forwardItem = viewMenu?.item(withTitle: "前进")
    let forceReloadItem = viewMenu?.item(withTitle: "忽略缓存重新加载")
    check(backItem != nil && forwardItem != nil && forceReloadItem != nil, "View menu items present")
    check(
        forceReloadItem?.keyEquivalent == "R" && forceReloadItem?.keyEquivalentModifierMask == [.command, .shift],
        "Force reload shortcut is Shift+Cmd+R"
    )
    check(controller.validateMenuItem(backItem!) == false, "Back disabled before second navigation")
    check(controller.validateMenuItem(forwardItem!) == false, "Forward disabled initially")

    _ = evalJS(controller.webView, "document.getElementById('page2-link').click()")
    let onPage2 = waitUntil(timeout: 5.0) {
        controller.webView.url?.path == "/page2" && !controller.webView.isLoading && controller.webView.canGoBack
    }
    check(onPage2, "navigated to /page2")
    check(controller.validateMenuItem(backItem!) == true, "Back enabled after navigating to /page2")

    controller.goBack()
    let backOnHome = waitUntil(timeout: 5.0) {
        (controller.webView.url?.path == "/" || controller.webView.url?.path == "")
            && !controller.webView.isLoading
            && controller.webView.canGoForward
    }
    check(backOnHome, "goBack returned to /")
    check(controller.validateMenuItem(forwardItem!) == true, "Forward enabled after goBack")

    // Window miniaturize/deminiaturize, close & Dock reopen reuse
    controller.window.miniaturize(nil)
    _ = waitUntil(timeout: 2.0) { controller.window.isMiniaturized }
    controller.window.deminiaturize(nil)
    _ = waitUntil(timeout: 2.0) { !controller.window.isMiniaturized && controller.window.isVisible }

    check(delegate.applicationShouldTerminateAfterLastWindowClosed(NSApp) == false, "app stays running when window closes")
    controller.window.performClose(nil)
    sleepRunLoop(0.1)
    check(!controller.window.isVisible, "window hidden after performClose")
    _ = delegate.applicationShouldHandleReopen(NSApp, hasVisibleWindows: false)
    sleepRunLoop(0.1)
    check(controller.window.isVisible, "Dock reopen restored the existing window")

    // 9. Waiting-for-save export cleaned up on exit
    var waitingStaged: StagedExport?
    controller.savePanelHandler = { staged, _ in
        waitingStaged = staged
        // Intentionally leave waiting without calling decide()
    }
    _ = evalJS(controller.webView, "window.triggerBlobDownload('left-open.json', '{}')")
    _ = waitUntil(timeout: 4.0) { waitingStaged != nil }
    let instanceDir = controller.exportStaging!.instanceDir
    check(fm.fileExists(atPath: waitingStaged!.tempFile.path), "waiting export exists before exit")
    controller.cleanupTemporaryDownloads()
    check(!fm.fileExists(atPath: instanceDir.path), "exit cleanup removed waiting-for-save export directory")
    controller.window.orderOut(nil)
}

@main
enum SelfOSMacVerifyMain {
    static func main() {
        var appURLStr: String?
        var bridgeURLStr: String?
        var evilURLStr: String?
        var extVolStr: String?

        var args = Array(CommandLine.arguments.dropFirst())
        while !args.isEmpty {
            let flag = args.removeFirst()
            guard !args.isEmpty else { break }
            let val = args.removeFirst()
            switch flag {
            case "--app-url": appURLStr = val
            case "--bridge-url": bridgeURLStr = val
            case "--evil-url": evilURLStr = val
            case "--external-volume-dir": extVolStr = val
            default: break
            }
        }

        let extVol = extVolStr.map { URL(fileURLWithPath: $0, isDirectory: true) }
        do {
            try runPurePolicyAndStagingChecks(externalVolumeDir: extVol)
            if let a = appURLStr, let b = bridgeURLStr, let e = evilURLStr,
               let appURL = URL(string: a), let bridgeURL = URL(string: b), let evilURL = URL(string: e) {
                let app = NSApplication.shared
                app.setActivationPolicy(.accessory)
                try MainActor.assumeIsolated {
                    try runWebKitAndWindowChecks(
                        appURL: appURL,
                        bridgeURL: bridgeURL,
                        evilURL: evilURL,
                        externalVolumeDir: extVol
                    )
                }
            }
            print("SELFOS_MAC_VERIFY_OK")
        } catch {
            fputs("Unexpected error: \(error)\n", stderr)
            exit(1)
        }
    }
}
