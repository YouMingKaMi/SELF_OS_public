import Darwin
import Foundation

public struct OriginKey: Equatable, Sendable {
    public let scheme: String
    public let host: String
    public let port: Int

    public init?(url: URL) {
        guard let rawScheme = url.scheme?.lowercased(),
              rawScheme == "https" || rawScheme == "http",
              let rawHost = url.host?.lowercased(),
              !rawHost.isEmpty
        else { return nil }
        self.scheme = rawScheme
        self.host = rawHost
        self.port = url.port ?? (rawScheme == "https" ? 443 : 80)
    }

    public init(scheme: String, host: String, port: Int) {
        self.scheme = scheme.lowercased()
        self.host = host.lowercased()
        self.port = port
    }

    public init?(protocolScheme: String, host: String, port: Int) {
        let s = protocolScheme.lowercased()
        let h = host.lowercased()
        guard (s == "https" || s == "http"), !h.isEmpty else { return nil }
        self.scheme = s
        self.host = h
        self.port = port == 0 ? (s == "https" ? 443 : 80) : port
    }

    public static func blobOrigin(_ url: URL) -> OriginKey? {
        guard url.scheme?.lowercased() == "blob" else { return nil }
        let raw = url.absoluteString
        guard raw.count > 5 else { return nil }
        let innerString = String(raw.dropFirst(5))
        guard let innerURL = URL(string: innerString) else { return nil }
        return OriginKey(url: innerURL)
    }
}

public enum SelfOSEndpoint {
    public static let wechatBridgeOrigin = OriginKey(scheme: "http", host: "127.0.0.1", port: 18766)

    public static func normalize(_ raw: String) -> URL? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let candidate: String
        if trimmed.contains("://") {
            candidate = trimmed
        } else if trimmed.hasPrefix("127.0.0.1") || trimmed.hasPrefix("localhost") {
            candidate = "http://" + trimmed
        } else {
            candidate = "https://" + trimmed
        }
        guard var components = URLComponents(string: candidate),
              components.user == nil,
              components.password == nil,
              let scheme = components.scheme?.lowercased(),
              let host = components.host?.lowercased(),
              !host.isEmpty
        else { return nil }

        let isLoopback = host == "127.0.0.1" || host == "localhost"
        guard scheme == "https" || (scheme == "http" && isLoopback) else { return nil }
        if let port = components.port, !(1...65535).contains(port) { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }
}

public enum NavigationOutcome: Equatable {
    case allow
    case download
    case loadInCurrentWebView(URL)
    case openExternal(URL)
    case cancel
}

public enum ResponseOutcome: Equatable {
    case allow
    case download
    case cancel
}

public enum SelfOSSecurityPolicy {
    public static func isExternalSafeScheme(_ url: URL) -> Bool {
        guard let s = url.scheme?.lowercased() else { return false }
        return s == "https" || s == "http" || s == "mailto"
    }

    public static func decideAction(
        appOrigin: OriginKey?,
        wechatOrigin: OriginKey = SelfOSEndpoint.wechatBridgeOrigin,
        url: URL?,
        shouldPerformDownload: Bool,
        sourceIsMainFrame: Bool,
        sourceOrigin: OriginKey?,
        targetFrameExists: Bool,
        targetIsMainFrame: Bool,
        isLinkActivated: Bool
    ) -> NavigationOutcome {
        guard let url else { return .cancel }
        let scheme = url.scheme?.lowercased() ?? ""

        // 1. Blob URLs: strictly restricted to trusted main-frame same-origin
        if scheme == "blob" {
            guard let appOrigin,
                  OriginKey.blobOrigin(url) == appOrigin,
                  sourceIsMainFrame,
                  sourceOrigin == appOrigin,
                  (!targetFrameExists || targetIsMainFrame)
            else { return .cancel }
            return shouldPerformDownload ? .download : .allow
        }

        // 2. About URLs: only exact about:blank and never as a download
        if scheme == "about" {
            guard url.absoluteString == "about:blank", !shouldPerformDownload else {
                return .cancel
            }
            return .allow
        }

        let targetOrigin = OriginKey(url: url)

        // 3. Explicit download attributes (<a download> / navigationAction.shouldPerformDownload)
        if shouldPerformDownload {
            if let appOrigin,
               targetOrigin == appOrigin,
               sourceIsMainFrame,
               sourceOrigin == appOrigin {
                return .download
            }
            if isLinkActivated && isExternalSafeScheme(url) {
                return .openExternal(url)
            }
            return .cancel
        }

        // 4. New window / target="_blank" (targetFrame == nil)
        if !targetFrameExists {
            if let appOrigin, targetOrigin == appOrigin {
                return .loadInCurrentWebView(url)
            }
            return isLinkActivated && isExternalSafeScheme(url) ? .openExternal(url) : .cancel
        }

        // 5. Main frame navigation
        if targetIsMainFrame {
            if let appOrigin, targetOrigin == appOrigin {
                return .allow
            }
            return isLinkActivated && isExternalSafeScheme(url) ? .openExternal(url) : .cancel
        }

        // 6. Subframe (iframe): allow same-origin or local WeChat Pay bridge only
        if (appOrigin != nil && targetOrigin == appOrigin) || targetOrigin == wechatOrigin {
            return .allow
        }
        if isLinkActivated && isExternalSafeScheme(url) {
            return .openExternal(url)
        }
        return .cancel
    }

    public static func decideResponse(
        appOrigin: OriginKey?,
        wechatOrigin: OriginKey = SelfOSEndpoint.wechatBridgeOrigin,
        responseURL: URL?,
        isForMainFrame: Bool,
        canShowMIMEType: Bool
    ) -> ResponseOutcome {
        guard let responseURL else { return .cancel }
        if responseURL.absoluteString == "about:blank" {
            return canShowMIMEType ? .allow : .cancel
        }

        let directOrigin = OriginKey(url: responseURL)
        let effectiveOrigin = directOrigin ?? OriginKey.blobOrigin(responseURL)

        if isForMainFrame {
            guard let appOrigin, effectiveOrigin == appOrigin else { return .cancel }
            return canShowMIMEType ? .allow : .download
        }

        // Subframes (including WeChat Pay bridge) must never trigger file downloads
        guard canShowMIMEType else { return .cancel }
        if (appOrigin != nil && directOrigin == appOrigin) || directOrigin == wechatOrigin {
            return .allow
        }
        return .cancel
    }

    public static func allowDownloadRedirect(appOrigin: OriginKey?, newRequestURL: URL?) -> Bool {
        guard let appOrigin, let newRequestURL else { return false }
        return OriginKey(url: newRequestURL) == appOrigin
    }

    public static func allowDownloadDestination(appOrigin: OriginKey?, responseURL: URL?) -> Bool {
        guard let appOrigin, let responseURL else { return false }
        let effectiveOrigin = OriginKey(url: responseURL) ?? OriginKey.blobOrigin(responseURL)
        return effectiveOrigin == appOrigin
    }
}

public struct StagedExport: Equatable {
    public let id: UUID
    public let exportDir: URL
    public let tempFile: URL
    public let suggestedFilename: String
}

private func fileStatus(_ url: URL) throws -> stat? {
    var info = stat()
    if lstat(url.path, &info) == 0 { return info }
    let code = errno
    if code == ENOENT { return nil }
    throw NSError(domain: NSPOSIXErrorDomain, code: Int(code))
}

private func atomicRename(_ source: URL, _ destination: URL, flags: UInt32) throws {
    guard renamex_np(source.path, destination.path, flags) == 0 else {
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
    }
}

public struct ExportDestination {
    private struct Identity: Equatable {
        let device: dev_t
        let inode: ino_t
        let changedSeconds: Int
        let changedNanoseconds: Int

        init(_ info: stat) {
            device = info.st_dev
            inode = info.st_ino
            changedSeconds = info.st_ctimespec.tv_sec
            changedNanoseconds = info.st_ctimespec.tv_nsec
        }
    }

    public let url: URL
    private let expected: Identity?

    public init(_ url: URL) throws {
        let parent = url.deletingLastPathComponent().resolvingSymlinksInPath()
        self.url = parent.appendingPathComponent(url.lastPathComponent)
        expected = try Self.identity(at: self.url)
    }

    private static func identity(at url: URL) throws -> Identity? {
        guard let info = try fileStatus(url) else { return nil }
        guard info.st_mode & S_IFMT == S_IFREG else {
            throw CocoaError(.fileWriteFileExists, userInfo: [NSURLErrorKey: url])
        }
        return Identity(info)
    }

    fileprivate func publish(_ staged: URL) throws {
        if let expected {
            let coordinator = NSFileCoordinator(filePresenter: nil)
            var coordinationError: NSError?
            var writeError: Error?
            coordinator.coordinate(writingItemAt: url, options: .forReplacing, error: &coordinationError) { target in
                do {
                    guard try Self.identity(at: target) == expected else {
                        throw CocoaError(.fileWriteFileExists, userInfo: [NSURLErrorKey: target])
                    }
                    _ = try FileManager.default.replaceItemAt(target, withItemAt: staged)
                } catch { writeError = error }
            }
            if let error = writeError ?? coordinationError { throw error }
        } else {
            try atomicRename(staged, url, flags: UInt32(RENAME_EXCL))
        }
    }
}

public final class ExportStagingManager {
    public let rootDir: URL
    public let instanceDir: URL
    private(set) public var trackedExports: [UUID: StagedExport] = [:]

    public init(
        baseRootDir: URL? = nil,
        pid: Int32 = ProcessInfo.processInfo.processIdentifier,
        cleanupStaleOnInit: Bool = true
    ) throws {
        let fm = FileManager.default
        let root = baseRootDir ?? fm.temporaryDirectory.appendingPathComponent(
            "org.personalcouncil.next.mac-exports",
            isDirectory: true
        )
        try fm.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        try fm.setAttributes([.posixPermissions: 0o700], ofItemAtPath: root.path)
        self.rootDir = root

        if cleanupStaleOnInit {
            Self.cleanupStaleProcessDirectories(in: root, currentPID: pid)
        }

        let instance = root.appendingPathComponent("pid-\(pid)-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: instance, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        self.instanceDir = instance
    }

    public static func sanitizeFilename(_ suggested: String) -> String {
        let trimmed = suggested.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let rawLast = trimmed.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last else {
            return "self-os-export.dat"
        }
        let base = String(rawLast).trimmingCharacters(in: .whitespacesAndNewlines)
        if base.isEmpty || base == "." || base == ".." {
            return "self-os-export.dat"
        }
        if base.hasPrefix(".") {
            let stripped = String(base.drop(while: { $0 == "." }))
            return stripped.isEmpty ? "self-os-export.dat" : stripped
        }
        return base
    }

    public static func cleanupStaleProcessDirectories(
        in root: URL,
        currentPID: Int32,
        isProcessAlive: (Int32) -> Bool = { pid in
            if kill(pid, 0) == 0 { return true }
            return errno == EPERM
        }
    ) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil) else { return }
        for entry in entries {
            let name = entry.lastPathComponent
            guard name.hasPrefix("pid-") else { continue }
            let parts = name.split(separator: "-", maxSplits: 2)
            guard parts.count >= 2, let pid = Int32(parts[1]), pid != currentPID else { continue }
            if !isProcessAlive(pid) {
                try? fm.removeItem(at: entry)
            }
        }
    }

    public func createStagedExport(suggestedFilename: String) throws -> StagedExport {
        let safeName = Self.sanitizeFilename(suggestedFilename)
        let id = UUID()
        let dir = instanceDir.appendingPathComponent("export-\(id.uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(
            at: dir,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        let file = dir.appendingPathComponent(safeName, isDirectory: false)
        let staged = StagedExport(id: id, exportDir: dir, tempFile: file, suggestedFilename: safeName)
        trackedExports[id] = staged
        return staged
    }

    /// Commits a staged export to `destinationURL` safely across volumes.
    /// Copies into an item-replacement directory on the destination's own volume before committing.
    /// If writing or replacing fails, `staged.tempFile` remains intact so the user can retry.
    public func commitStagedExport(_ staged: StagedExport, to destination: ExportDestination) throws {
        let fm = FileManager.default
        let destinationURL = destination.url
        let targetParent = destinationURL.deletingLastPathComponent()
        let replacementDir = try fm.url(
            for: .itemReplacementDirectory,
            in: .userDomainMask,
            appropriateFor: fm.fileExists(atPath: destinationURL.path) ? destinationURL : targetParent,
            create: true
        )
        defer { try? fm.removeItem(at: replacementDir) }

        let stagedOnTargetVolume = replacementDir.appendingPathComponent(destinationURL.lastPathComponent, isDirectory: false)
        try fm.copyItem(at: staged.tempFile, to: stagedOnTargetVolume)

        try destination.publish(stagedOnTargetVolume)
        discardStagedExport(staged)
    }

    public func discardStagedExport(_ staged: StagedExport) {
        trackedExports.removeValue(forKey: staged.id)
        try? FileManager.default.removeItem(at: staged.exportDir)
    }

    public func cleanupAll() {
        trackedExports.removeAll()
        try? FileManager.default.removeItem(at: instanceDir)
    }
}

#if SELFOS_INSTALLER
@main
enum SelfOSBundlePublisher {
    static func main() throws {
        let args = CommandLine.arguments
        guard args.count == 4 else { throw CocoaError(.fileWriteInvalidFileName) }
        let source = URL(fileURLWithPath: args[1], isDirectory: true)
        let destination = URL(fileURLWithPath: args[2], isDirectory: true)
        let parent = destination.deletingLastPathComponent()
        let lock = open(parent.path, O_RDONLY | O_DIRECTORY)
        guard lock >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
        defer { close(lock) }
        guard flock(lock, LOCK_EX) == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }

        let flags: UInt32
        if let current = try fileStatus(destination) {
            let kind = current.st_mode & S_IFMT
            guard kind != S_IFLNK else { fail("Refusing to overwrite symbolic link") }
            let infoURL = destination.appendingPathComponent("Contents/Info.plist")
            guard kind == S_IFDIR, let plist = try? Data(contentsOf: infoURL),
                  let info = try? PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any],
                  info["CFBundleIdentifier"] as? String == args[3] else {
                fail("Refusing to overwrite foreign bundle or non-bundle target")
            }
            flags = UInt32(RENAME_SWAP)
        } else {
            flags = UInt32(RENAME_EXCL)
        }
        do {
            try atomicRename(source, destination, flags: flags)
        } catch {
            fail("Could not publish app bundle: \(error.localizedDescription)")
        }
    }

    private static func fail(_ message: String) -> Never {
        FileHandle.standardError.write(Data((message + "\n").utf8))
        exit(1)
    }
}
#endif
