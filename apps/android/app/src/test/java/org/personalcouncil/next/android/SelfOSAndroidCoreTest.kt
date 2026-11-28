package org.personalcouncil.next.android

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class SelfOSAndroidCoreTest {
    @get:Rule
    val temporary = TemporaryFolder()

    private val app = OriginKey("https", "app.example.test", 443)

    @Test
    fun localAssetRoutesOnlyTheBundledOriginAndNormalizesSpaPaths() {
        assertEquals(OriginKey("https", LOCAL_ASSET_HOST, 443), LOCAL_ORIGIN)
        assertEquals(LOCAL_ORIGIN, OriginKey.parse(LOCAL_START_URL))
        for (path in listOf("", "habits", "expenses?from=settings#top", "storage/", "habits/today", "./storage")) {
            assertEquals(path, AssetResolution.SpaFallback, SelfOSAssetRouting.resolveWebAsset(LOCAL_START_URL + path))
        }
        for (path in listOf("assets/index-x.js", "favicon.svg", "assets/a%20b.css", "assets/a%25b.css")) {
            val expected = when (path) {
                "assets/a%20b.css" -> AssetResolution.File("web/assets/a b.css")
                "assets/a%25b.css" -> AssetResolution.Blocked
                else -> AssetResolution.File("web/$path")
            }
            assertEquals(path, expected, SelfOSAssetRouting.resolveWebAsset(LOCAL_START_URL + path + "?cache=1"))
        }
        assertNull(SelfOSEndpoint.normalize(LOCAL_START_URL))
    }

    @Test
    fun localAssetsBlockApiTraversalAndOtherOrigins() {
        for (path in listOf(
            "v1", "v1/", "v1/events", "%76%31%2fquotes", "./v1/pair", "/v1/commands",
            "assets/../index.html", "assets/%2e%2E/index.html", "%2e%2e%2findex.html",
            "assets\\index.js", "assets%5cindex.js", "assets/%00.js", "assets/%GG.js",
            "assets/%252e%252e/index.html", "assets/%ff.js",
        )) {
            assertEquals(path, AssetResolution.Blocked, SelfOSAssetRouting.resolveWebAsset(LOCAL_START_URL + path))
        }
        for (url in listOf(
            app.toUrl(), "http://$LOCAL_ASSET_HOST", "https://$LOCAL_ASSET_HOST:444",
            "https://other.$LOCAL_ASSET_HOST", "https://name@$LOCAL_ASSET_HOST",
        )) {
            assertEquals(url, AssetResolution.Blocked, SelfOSAssetRouting.resolveWebAsset(url))
        }
    }

    @Test
    fun localAssetMimeTypesMatchTheEmbeddedFiles() {
        val expected = mapOf(
            "index.html" to "text/html; charset=utf-8",
            "bundle.js" to "application/javascript; charset=utf-8",
            "worker.MJS" to "application/javascript; charset=utf-8",
            "styles.css" to "text/css; charset=utf-8",
            "favicon.svg" to "image/svg+xml",
            "backup.json" to "application/json; charset=utf-8",
            "app.webmanifest" to "application/json; charset=utf-8",
            "favicon.png" to "image/png",
            "favicon.ico" to "image/x-icon",
            "letters.woff2" to "font/woff2",
            "binary.bin" to "application/octet-stream",
        )
        for ((file, mime) in expected) assertEquals(file, mime, SelfOSAssetRouting.mimeTypeForAsset("web/$file"))
    }

    @Test
    fun localOriginUsesTheSameNavigationAndBridgeTrustRules() {
        val local = LOCAL_START_URL + "habits"
        val external = app.toUrl() + "/habits"
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideMainFrameNavigation(LOCAL_ORIGIN, local, false))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideMainFrameNavigation(LOCAL_ORIGIN, external, false))
        assertEquals(NavigationOutcome.OPEN_EXTERNAL(external), SelfOSSecurityPolicy.decideMainFrameNavigation(LOCAL_ORIGIN, external, true))
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideSubframeNavigation(LOCAL_ORIGIN, local))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideSubframeNavigation(LOCAL_ORIGIN, external))
        assertTrue(SelfOSSecurityPolicy.isBridgeCallerAllowed(LOCAL_ORIGIN, local))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(LOCAL_ORIGIN, external))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(app, local))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(LOCAL_ORIGIN, "about:blank"))
    }

    @Test
    fun originParsesOnlyUnambiguousHttpAndHttpsAuthorities() {
        assertEquals(app, OriginKey.parse("HTTPS://APP.example.test:443/route?q=1#top"))
        assertEquals(OriginKey("http", "localhost", 80), OriginKey.parse("http://localhost/"))
        assertEquals(OriginKey("https", "app.example.test", 9443), OriginKey.parse("https://app.example.test:9443"))
        assertEquals("https://app.example.test", app.toUrl())
        for (url in listOf(
            "file:///tmp/sample", "https:app.example.test", "//app.example.test",
            "https://user:pass@app.example.test", "https://app.example.test:",
            "https://app.example.test:0", "https://app.example.test:65536",
            "https://app.example.test:2147483648", "https://app.example.test:-1",
            "https://app.example.test:port", "https://app.example.test\\@outside.example.test",
            "https://%61pp.example.test/",
        )) {
            assertNull(url, OriginKey.parse(url))
        }
    }

    @Test
    fun blobParserRecognizesOnlyAnHttpOrigin() {
        assertEquals(app, OriginKey.blobOrigin("blob:https://app.example.test/9689"))
        assertEquals(OriginKey("http", "localhost", 8900), OriginKey.blobOrigin("blob:http://localhost:8900/id"))
        assertNull(OriginKey.blobOrigin("blob:null/id"))
        assertNull(OriginKey.blobOrigin("blob:file:///id"))
        assertNull(OriginKey.blobOrigin("https://app.example.test/id"))
    }

    @Test
    fun endpointNormalizesAndDropsNonOriginComponents() {
        val endpoints = mapOf(
            "  App.Example.Test:9443/route?key=discard#top " to "https://app.example.test:9443",
            "https://app.example.test:443/sync" to "https://app.example.test",
            "127.0.0.1:8900/home" to "http://127.0.0.1:8900",
            "LOCALHOST:80" to "http://localhost",
            "10.0.2.2/path" to "http://10.0.2.2",
            "HTTPS://localhost:443" to "https://localhost",
        )
        for ((input, expected) in endpoints) assertEquals(input, expected, SelfOSEndpoint.normalize(input))
        for (input in listOf(
            "", "  ", "https://user@app.example.test", "person:secret@app.example.test",
            "http://app.example.test", "http://192.168.1.10", "http://127.0.0.2",
            "http://127.0.0.1.evil.example.test", "http://a.localhost", "http://localhost.",
            "http://127.1", "http://2130706433", "http://[::1]",
            "localhost:0", "app.example.test:65536", "https://app.example.test:",
            "https://app.example.test\\@outside.example.test", "//app.example.test",
            "javascript:alert(1)", "intent://app.example.test/#Intent", "file:///tmp/sample",
        )) {
            assertNull(input, SelfOSEndpoint.normalize(input))
        }
    }

    @Test
    fun mainFrameUsesGestureOnlyForSafeExternalTargets() {
        val external = "https://outside.example.test/"
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideMainFrameNavigation(app, app.toUrl(), false))
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideMainFrameNavigation(app, "about:blank", false))
        assertEquals(NavigationOutcome.OPEN_EXTERNAL(external), SelfOSSecurityPolicy.decideMainFrameNavigation(app, external, true))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideMainFrameNavigation(app, external, false))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideMainFrameNavigation(app, null, true))
        assertTrue(SelfOSSecurityPolicy.isExternalSafeScheme("http://outside.example.test/path"))
        assertTrue(SelfOSSecurityPolicy.isExternalSafeScheme("mailto:reader@example.test?subject=Hello"))
        assertFalse(SelfOSSecurityPolicy.isExternalSafeScheme("mailto://outside.example.test"))
        for (url in listOf(
            "file:///tmp/example", "content://sample/item", "intent://sample/#Intent",
            "javascript:alert(1)", "data:text/html,unsafe", "blob:https://app.example.test/id",
            "https:outside.example.test", "https://hidden@outside.example.test/", "about:blank#other",
        )) {
            assertEquals(url, NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideMainFrameNavigation(app, url, true))
        }
    }

    @Test
    fun framesWindowsAndBridgeHaveTheirOwnPolicies() {
        val same = "https://APP.example.test:443/page"
        val otherPort = "https://app.example.test:444/"
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideSubframeNavigation(app, same))
        assertEquals(NavigationOutcome.ALLOW, SelfOSSecurityPolicy.decideSubframeNavigation(app, "about:blank"))
        for (target in listOf(otherPort, "http://app.example.test", "https://child.app.example.test", "content://file", null)) {
            assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideSubframeNavigation(app, target))
            assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(app, target))
        }
        assertEquals(NavigationOutcome.LOAD_IN_CURRENT(same), SelfOSSecurityPolicy.decideNewWindowNavigation(app, same, false))
        assertEquals(NavigationOutcome.OPEN_EXTERNAL(otherPort), SelfOSSecurityPolicy.decideNewWindowNavigation(app, otherPort, true))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideNewWindowNavigation(app, otherPort, false))
        assertEquals(NavigationOutcome.CANCEL, SelfOSSecurityPolicy.decideNewWindowNavigation(app, "intent://app.example.test", true))
        assertTrue(SelfOSSecurityPolicy.isBridgeCallerAllowed(app, same))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(app, "about:blank"))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(app, "blob:https://app.example.test/id"))
        assertFalse(SelfOSSecurityPolicy.isBridgeCallerAllowed(null, same))
    }

    @Test
    fun metadataCannotEscapeTheExportOrInjectMimeParameters() {
        assertEquals("账本.json", ExportStagingStore.sanitizeFilename("../path\\...账本.json"))
        assertEquals("notes.md", ExportStagingStore.sanitizeFilename("...\u202Enotes.md\n"))
        assertEquals("self-os-export.dat", ExportStagingStore.sanitizeFilename("../../"))
        assertEquals("self-os-export.dat", ExportStagingStore.sanitizeFilename(".."))
        assertEquals("application/vnd.selfos+json", ExportStagingStore.sanitizeMimeType(" Application/vnd.SelfOS+JSON "))
        assertEquals("text/markdown", ExportStagingStore.sanitizeMimeType("text/markdown"))
        for (mime in listOf(null, "", "*/*", "text/html;extra=1", "application/json\r\nOther: x")) {
            assertEquals("application/octet-stream", ExportStagingStore.sanitizeMimeType(mime))
        }
        val long = ExportStagingStore.sanitizeFilename("🍀".repeat(70) + ".json")
        assertTrue(long.toByteArray().size <= 240)
        assertTrue(long.endsWith(".json"))
    }

    @Test
    fun writesOrderedTextAndJoinsUnicodeAcrossChunks() {
        val directory = temporary.newFolder()
        val store = ExportStagingStore(directory)
        val id = requireNotNull(store.begin("../../.backup.json", "application/json"))
        val other = requireNotNull(store.begin("backup.json", null))
        assertNotEquals(id, other)
        assertTrue(store.append(id, "{\"greeting\":\"你好\uD83C"))
        assertTrue(store.append(id, ""))
        assertTrue(store.append(id, "\uDF40\"}"))
        val export = requireNotNull(store.finish(id))
        assertEquals("backup.json", export.filename)
        assertEquals("application/json", export.mimeType)
        assertEquals(directory, export.file.parentFile.parentFile)
        assertArrayEquals("{\"greeting\":\"你好🍀\"}".toByteArray(), export.file.readBytes())
        assertEquals(export, store.finishedExport(id))
        assertFalse(store.append(id, "extra"))
        assertNull(store.finish(id))
        store.abort(id)
        store.abort(other)
        store.abort(id)
        assertFalse(export.file.exists())
        assertEquals(emptyList<File>(), directory.listFiles()?.toList())
    }

    @Test
    fun exportLimitCountsUtf8BytesAndRemovesThePartialFile() {
        val directory = temporary.newFolder()
        val store = ExportStagingStore(directory, maxBytes = 5)
        val exact = requireNotNull(store.begin("exact", null))
        assertTrue(store.append(exact, "你ab"))
        assertEquals(5L, requireNotNull(store.finish(exact)).file.length())
        store.abort(exact)

        val tooBig = requireNotNull(store.begin("too-big", null))
        assertTrue(store.append(tooBig, "你"))
        assertFalse(store.append(tooBig, "好"))
        assertNull(store.finish(tooBig))
        val tooLongChunk = requireNotNull(store.begin("chunk", null))
        assertFalse(store.append(tooLongChunk, " ".repeat(128 * 1024 + 1)))
        assertNull(store.finish(tooLongChunk))
        assertFalse(store.append("../outside", "escape"))
        assertEquals(emptyList<File>(), directory.listFiles()?.toList())
    }

    @Test
    fun defaultLimitAccepts64MiBAndRejectsAnotherByte() {
        val directory = temporary.newFolder()
        val store = ExportStagingStore(directory)
        val id = requireNotNull(store.begin("large.md", "text/markdown"))
        val chunk = "a".repeat(128 * 1024)
        repeat(512) { assertTrue(store.append(id, chunk)) }
        assertFalse(store.append(id, "x"))
        assertNull(store.finish(id))
        assertEquals(emptyList<File>(), directory.listFiles()?.toList())
    }

    @Test
    fun startupRemovesStalePayloadAndLeavesOtherCacheEntries() {
        val directory = temporary.newFolder()
        val staleStore = ExportStagingStore(directory)
        val stale = requireNotNull(staleStore.begin("stale", null))
        assertTrue(staleStore.append(stale, "partial"))
        val unrelated = File(directory, "keep.txt").apply { writeText("keep") }
        val newStore = ExportStagingStore(directory)
        assertNull(newStore.finishedExport(stale))
        assertTrue(unrelated.exists())
        assertEquals(listOf(unrelated), directory.listFiles()?.toList())
        val fresh = requireNotNull(newStore.begin("fresh", null))
        assertNotNull(newStore.finish(fresh))
        newStore.abort(fresh)
    }
}
