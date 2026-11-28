package org.personalcouncil.next.android

import java.io.File
import java.io.IOException
import java.net.URI
import java.net.URISyntaxException
import java.nio.file.Files
import java.nio.file.LinkOption.NOFOLLOW_LINKS
import java.util.Locale
import java.util.UUID

private fun parseUri(raw: String): URI? = try {
    URI(raw)
} catch (_: URISyntaxException) {
    null
}

data class OriginKey(val scheme: String, val host: String, val port: Int) {
    fun toUrl(): String {
        val defaultPort = if (scheme == "https") 443 else 80
        return if (port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
    }

    companion object {
        fun parse(rawUrl: String): OriginKey? {
            val uri = parseUri(rawUrl) ?: return null
            val scheme = uri.scheme?.lowercase(Locale.ROOT)
            val defaultPort = when (scheme) {
                "http" -> 80
                "https" -> 443
                else -> return null
            }
            val host = uri.host?.lowercase(Locale.ROOT) ?: return null
            val authority = uri.rawAuthority ?: return null
            if (uri.rawUserInfo != null || authority.endsWith(':') || '%' in host) return null

            val port = if (uri.port == -1) defaultPort else uri.port
            if (port !in 1..65535) return null
            return OriginKey(scheme, host, port)
        }

        fun blobOrigin(rawUrl: String): OriginKey? =
            if (rawUrl.startsWith("blob:", ignoreCase = true)) parse(rawUrl.substring(5)) else null
    }
}

const val LOCAL_ASSET_HOST = "appassets.androidplatform.net"
val LOCAL_ORIGIN = OriginKey("https", LOCAL_ASSET_HOST, 443)
const val LOCAL_START_URL = "https://appassets.androidplatform.net/"

enum class ShellMode { LOCAL, REMOTE }

sealed interface AssetResolution {
    data class File(val assetPath: String) : AssetResolution
    data object SpaFallback : AssetResolution
    data object Blocked : AssetResolution
}

object SelfOSAssetRouting {
    fun resolveWebAsset(rawUrl: String): AssetResolution {
        if (OriginKey.parse(rawUrl) != LOCAL_ORIGIN) return AssetResolution.Blocked
        val path = parseUri(rawUrl)?.path ?: return AssetResolution.Blocked
        // URI.path decodes percent escapes once. Reject residual escapes rather than decoding again.
        if (path.any { it == '\\' || it == '%' || it.isISOControl() || it == '\uFFFD' }) return AssetResolution.Blocked
        val segments = path.split('/')
        if (".." in segments) return AssetResolution.Blocked
        val normalized = segments.filter { it.isNotEmpty() && it != "." }
        if (normalized.firstOrNull() == "v1") return AssetResolution.Blocked
        if (normalized.isEmpty() || '.' !in normalized.last()) return AssetResolution.SpaFallback
        return AssetResolution.File("web/" + normalized.joinToString("/"))
    }

    fun mimeTypeForAsset(assetPath: String): String =
        when (assetPath.substringAfterLast('.', "").lowercase(Locale.ROOT)) {
            "html" -> "text/html; charset=utf-8"
            "js", "mjs" -> "application/javascript; charset=utf-8"
            "css" -> "text/css; charset=utf-8"
            "svg" -> "image/svg+xml"
            "json", "webmanifest" -> "application/json; charset=utf-8"
            "png" -> "image/png"
            "ico" -> "image/x-icon"
            "woff2" -> "font/woff2"
            else -> "application/octet-stream"
        }
}

object SelfOSEndpoint {
    private val explicitScheme = Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://")
    private val bareAddress = Regex("^(?:\\[[0-9a-fA-F:.]+]|[a-zA-Z0-9.-]+)(?::[0-9]+)?$")
    private val localHosts = setOf("127.0.0.1", "localhost", "10.0.2.2")

    fun normalize(raw: String): String? {
        val trimmed = raw.trim()
        if (trimmed.isEmpty() || '\\' in trimmed) return null
        val url = if (explicitScheme.containsMatchIn(trimmed)) {
            trimmed
        } else {
            val authority = trimmed.takeWhile { it !in "/?#" }
            if (!bareAddress.matches(authority)) return null
            val host = OriginKey.parse("https://$authority")?.host ?: return null
            val scheme = if (host in localHosts) "http" else "https"
            "$scheme://$trimmed"
        }
        val origin = OriginKey.parse(url) ?: return null
        if (origin.host == LOCAL_ASSET_HOST || origin.scheme == "http" && origin.host !in localHosts) return null
        return origin.toUrl()
    }
}

sealed interface NavigationOutcome {
    data object ALLOW : NavigationOutcome
    data object CANCEL : NavigationOutcome
    data class LOAD_IN_CURRENT(val url: String) : NavigationOutcome
    data class OPEN_EXTERNAL(val url: String) : NavigationOutcome
}

object SelfOSSecurityPolicy {
    fun isExternalSafeScheme(rawUrl: String): Boolean {
        if (OriginKey.parse(rawUrl) != null) return true
        val uri = parseUri(rawUrl) ?: return false
        return uri.scheme.equals("mailto", ignoreCase = true) && uri.isOpaque &&
            uri.rawSchemeSpecificPart.isNotBlank()
    }

    fun decideMainFrameNavigation(
        appOrigin: OriginKey?,
        targetUrl: String?,
        hasUserGesture: Boolean,
    ): NavigationOutcome {
        if (targetUrl == null) return NavigationOutcome.CANCEL
        if (isBridgeCallerAllowed(appOrigin, targetUrl) || isBlankPage(targetUrl)) {
            return NavigationOutcome.ALLOW
        }
        return externalNavigation(targetUrl, hasUserGesture)
    }

    fun decideSubframeNavigation(appOrigin: OriginKey?, targetUrl: String?): NavigationOutcome =
        if (targetUrl != null && (isBridgeCallerAllowed(appOrigin, targetUrl) || isBlankPage(targetUrl))) {
            NavigationOutcome.ALLOW
        } else {
            NavigationOutcome.CANCEL
        }

    fun decideNewWindowNavigation(
        appOrigin: OriginKey?,
        targetUrl: String?,
        hasUserGesture: Boolean,
    ): NavigationOutcome {
        if (targetUrl == null) return NavigationOutcome.CANCEL
        if (isBridgeCallerAllowed(appOrigin, targetUrl)) {
            return NavigationOutcome.LOAD_IN_CURRENT(targetUrl)
        }
        return externalNavigation(targetUrl, hasUserGesture)
    }

    fun isBridgeCallerAllowed(appOrigin: OriginKey?, currentPageUrl: String?): Boolean =
        appOrigin != null && currentPageUrl != null && OriginKey.parse(currentPageUrl) == appOrigin

    private fun isBlankPage(url: String): Boolean = url.equals("about:blank", ignoreCase = true)

    private fun externalNavigation(url: String, hasUserGesture: Boolean): NavigationOutcome =
        if (hasUserGesture && isExternalSafeScheme(url)) {
            NavigationOutcome.OPEN_EXTERNAL(url)
        } else {
            NavigationOutcome.CANCEL
        }
}

class ExportStagingStore(
    private val root: File,
    private val maxBytes: Long = 64L * 1024 * 1024,
) {
    data class StagedExport(val id: String, val filename: String, val mimeType: String, val file: File)

    private class Entry(val export: StagedExport) {
        var bytes = 0L
        var trailingHighSurrogate = ""
        var finished = false
    }

    private val entries = mutableMapOf<String, Entry>()

    init {
        require(maxBytes > 0)
        Files.createDirectories(root.toPath())
        require(Files.isDirectory(root.toPath(), NOFOLLOW_LINKS))
        // This directory belongs to one process-wide store. Remove unfinished files from its previous run.
        Files.newDirectoryStream(root.toPath(), "export-*").use { dirs ->
            for (dir in dirs) {
                if (!Files.isDirectory(dir, NOFOLLOW_LINKS)) continue
                runCatching {
                    Files.deleteIfExists(dir.resolve("payload"))
                    Files.deleteIfExists(dir)
                }
            }
        }
    }

    @Synchronized
    fun begin(filename: String, mimeType: String?): String? {
        if (entries.size >= 4) return null
        return try {
            val id = UUID.randomUUID().toString()
            val dir = Files.createDirectory(root.toPath().resolve("export-$id"))
            val file = dir.resolve("payload").toFile()
            try {
                Files.createFile(file.toPath())
            } catch (failure: IOException) {
                runCatching { Files.deleteIfExists(dir) }
                throw failure
            }
            entries[id] = Entry(StagedExport(id, sanitizeFilename(filename), sanitizeMimeType(mimeType), file))
            id
        } catch (_: IOException) {
            null
        }
    }

    @Synchronized
    fun append(id: String, chunk: String): Boolean {
        val entry = entries[id]?.takeUnless { it.finished } ?: return false
        if (chunk.length > 128 * 1024) {
            abort(id)
            return false
        }
        val text = entry.trailingHighSurrogate + chunk
        // JavaScript can split a UTF-16 surrogate pair at a chunk boundary.
        val hasTrailingSurrogate = text.lastOrNull()?.isHighSurrogate() == true
        entry.trailingHighSurrogate = if (hasTrailingSurrogate) text.takeLast(1) else ""
        return write(entry, if (hasTrailingSurrogate) text.dropLast(1) else text)
    }

    @Synchronized
    fun finish(id: String): StagedExport? {
        val entry = entries[id]?.takeUnless { it.finished } ?: return null
        if (entry.trailingHighSurrogate.isNotEmpty() && !write(entry, "\uFFFD")) return null
        entry.finished = true
        return entry.export
    }

    @Synchronized
    fun finishedExport(id: String): StagedExport? = entries[id]?.takeIf { it.finished }?.export

    @Synchronized
    fun abort(id: String) {
        val file = entries.remove(id)?.export?.file ?: return
        runCatching {
            Files.deleteIfExists(file.toPath())
            Files.deleteIfExists(file.parentFile.toPath())
        }
    }

    private fun write(entry: Entry, text: String): Boolean {
        val bytes = text.toByteArray(Charsets.UTF_8)
        if (bytes.size > maxBytes - entry.bytes) {
            abort(entry.export.id)
            return false
        }
        return try {
            if (bytes.isNotEmpty()) entry.export.file.appendBytes(bytes)
            entry.bytes += bytes.size
            true
        } catch (_: IOException) {
            abort(entry.export.id)
            false
        }
    }

    companion object {
        private val unsafeFilename = Regex("[\\p{Cc}\\p{Cf}:*?\"<>|]")
        private val filenameExtension = Regex("[a-zA-Z0-9]{1,12}")
        private val mimeType = Regex("[a-z0-9][a-z0-9!#$&^_.+-]{0,126}/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}")

        fun sanitizeFilename(suggested: String): String {
            val leaf = suggested.replace('\\', '/').substringAfterLast('/')
                .replace(unsafeFilename, "").trim().trimStart { it == '.' || it.isWhitespace() }
            if (leaf.isEmpty()) return "self-os-export.dat"
            // At most 240 UTF-8 bytes, with room for document providers to disambiguate the name.
            if (leaf.toByteArray(Charsets.UTF_8).size <= 240) return leaf.trimEnd { it == '.' || it.isWhitespace() }
            val extension = leaf.substringAfterLast('.', "").takeIf { filenameExtension.matches(it) }
            val suffix = extension?.let { ".$it" }.orEmpty()
            val basename = if (suffix.isEmpty()) leaf else leaf.removeSuffix(suffix)
            val maxCodePoints = (240 - suffix.length) / 4
            val end = basename.offsetByCodePoints(0, minOf(basename.codePointCount(0, basename.length), maxCodePoints))
            return basename.substring(0, end).trimEnd { it == '.' || it.isWhitespace() } + suffix
        }

        fun sanitizeMimeType(raw: String?): String {
            val normalized = raw?.trim()?.lowercase(Locale.ROOT)
            return normalized?.takeIf(mimeType::matches) ?: "application/octet-stream"
        }
    }
}
