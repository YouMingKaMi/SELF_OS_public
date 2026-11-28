package org.personalcouncil.next.android

import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.os.Process
import android.os.SystemClock
import android.provider.DocumentsContract
import android.text.InputType
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.io.ByteArrayInputStream
import java.io.File
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.max
import kotlin.math.roundToInt

class MainActivity : ComponentActivity() {
    private val preferences by lazy { getSharedPreferences("shell", MODE_PRIVATE) }
    private val defaultEndpoint by lazy { SelfOSEndpoint.normalize(BuildConfig.DEFAULT_ENDPOINT) }
    private val exports by lazy { exportStore(applicationContext) }
    private var endpoint: String? = null
    private var shellMode = ShellMode.REMOTE
    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .setDomain(LOCAL_ASSET_HOST)
            .addPathHandler("/web/") { path -> localAssetResponse("web/$path") }
            .build()
    }
    private var appOrigin: OriginKey? = null
    private var webView: WebView? = null
    private var bridge: NativeBridge? = null
    private val popupViews = mutableSetOf<WebView>()
    private lateinit var root: FrameLayout
    private lateinit var overlay: FrameLayout
    private var lightTheme = false
    private var screen = Screen.Onboarding
    private var failedUrl: String? = null
    private var insets = WindowInsetsCompat.CONSUMED
    private var lastBackPress = -2_000L
    private var backInFlight = false
    private var settingsDialog: AlertDialog? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var filePickerInFlight = false
    private var pendingExportId: String? = null

    private enum class Screen { Onboarding, Loading, Web, Error }

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        filePickerInFlight = false
        val callback = fileCallback
        fileCallback = null
        if (callback != null) {
            val data = result.data
            val files = if (result.resultCode == RESULT_OK && data != null && trustedPage()) {
                val clip = data.clipData
                val chosen = if (clip == null) listOfNotNull(data.data)
                else (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
                chosen.takeIf { it.isNotEmpty() && it.all(::isReadableContentUri) }?.toTypedArray()
            } else null
            callback.onReceiveValue(files)
        }
    }

    private val createExport = registerForActivityResult(object : ActivityResultContracts.CreateDocument(
        "application/octet-stream",
    ) {
        override fun createIntent(context: Context, input: String): Intent =
            super.createIntent(context, input).apply {
                type = pendingExportId?.let { exports.finishedExport(it)?.mimeType } ?: type
            }
    }) { uri ->
        val id = pendingExportId
        pendingExportId = null
        if (id != null) completeExport(id, uri)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        lightTheme = preferences.getString("theme", "dark") == "light"
        setTheme(shellTheme())
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 29) {
            window.isStatusBarContrastEnforced = false
            window.isNavigationBarContrastEnforced = false
        }
        pendingExportId = savedInstanceState?.getString("pendingExport")
        filePickerInFlight = savedInstanceState?.getBoolean("filePickerInFlight") == true

        root = FrameLayout(this)
        overlay = FrameLayout(this).apply {
            isClickable = true
            isFocusable = true
        }
        root.addView(overlay, matchParent())
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, next ->
            insets = next
            padOverlay()
            applyWebInsets()
            next
        }
        applyTheme()
        ViewCompat.requestApplyInsets(root)
        CookieManager.getInstance().setAcceptCookie(true)
        val appContext = applicationContext
        exportWriter.execute { runCatching { exportStore(appContext) } }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = handleShellBack()
        })

        val savedEndpoint = preferences.getString("endpoint", null)?.let(SelfOSEndpoint::normalize)
        val savedPage = savedInstanceState?.getString("page")
        if (preferences.getString("mode", null) == "local") openLocalMode(savedPage)
        else openEndpoint(savedEndpoint ?: defaultEndpoint, savedPage)
        if (savedInstanceState?.getBoolean("settingsOpen") ?: (intent.action == ACTION_CONNECTION_SETTINGS)) {
            showEndpointSettings()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_CONNECTION_SETTINGS) showEndpointSettings()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString("page", webView?.url?.takeIf(::isSameOrigin) ?: failedUrl)
        outState.putString("pendingExport", pendingExportId)
        outState.putBoolean("filePickerInFlight", filePickerInFlight)
        outState.putBoolean("settingsOpen", settingsDialog?.isShowing == true)
    }

    override fun onPause() {
        webView?.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onStop() {
        CookieManager.getInstance().flush()
        super.onStop()
    }

    override fun onDestroy() {
        settingsDialog?.dismiss()
        closeWebView()
        if (!isChangingConfigurations) pendingExportId?.let { exports.abort(it) }
        super.onDestroy()
    }

    private fun openEndpoint(address: String?, page: String? = null) {
        endpoint = address
        val origin = address?.let(OriginKey::parse)
        openWorkspace(ShellMode.REMOTE, origin, address?.let { "$it/" }, page)
    }

    private fun openLocalMode(page: String? = null) {
        preferences.edit().putString("mode", "local").apply()
        openWorkspace(ShellMode.LOCAL, LOCAL_ORIGIN, LOCAL_START_URL, page)
    }

    private fun retryWorkspace() {
        if (shellMode == ShellMode.LOCAL) openLocalMode(failedUrl)
        else openEndpoint(endpoint, failedUrl)
    }

    private fun openWorkspace(mode: ShellMode, origin: OriginKey?, startUrl: String?, page: String?) {
        closeWebView()
        shellMode = mode
        appOrigin = origin
        failedUrl = null
        lastBackPress = -2_000L
        if (startUrl == null || origin == null) {
            showScreen(Screen.Onboarding)
            return
        }

        val view = WebView(this)
        webView = view
        view.setBackgroundColor(shellColor())
        configureWebView(view)
        view.webViewClient = WorkspaceClient(origin, mode)
        view.webChromeClient = WorkspaceChrome()
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            val sessionBridge = NativeBridge(view)
            bridge = sessionBridge
            view.addJavascriptInterface(sessionBridge, RAW_BRIDGE_NAME)
            WebViewCompat.addDocumentStartJavaScript(
                view,
                facadeScript(sessionBridge.token),
                setOf(origin.toUrl()),
            )
        }
        root.addView(view, 0, matchParent())
        showScreen(Screen.Loading)
        view.loadUrl(page?.takeIf(::isSameOrigin) ?: startUrl)
    }

    @Suppress("SetJavaScriptEnabled")
    private fun configureWebView(view: WebView) {
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(true)
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    }

    private fun closeWebView() {
        cancelFileSelection()
        popupViews.toList().forEach(::closePopup)
        bridge?.close()
        bridge = null
        backInFlight = false
        val view = webView ?: return
        webView = null
        view.removeJavascriptInterface(RAW_BRIDGE_NAME)
        view.stopLoading()
        root.removeView(view)
        view.destroy()
    }

    private fun localAssetResponse(assetPath: String): WebResourceResponse {
        val contentType = SelfOSAssetRouting.mimeTypeForAsset(assetPath)
        val encoding = if ("charset=" in contentType) "UTF-8" else null
        val headers = if (contentType.startsWith("text/html")) {
            // The APK serves the shell directly. Only bundled /assets/ workers may start.
            mapOf("Content-Security-Policy" to "connect-src 'none'; worker-src ${LOCAL_START_URL}assets/")
        } else emptyMap()
        return try {
            WebResourceResponse(contentType.substringBefore(';'), encoding, 200, "OK", headers, assets.open(assetPath))
        } catch (_: IOException) {
            emptyResponse(404, "Not Found")
        }
    }

    private inner class WorkspaceClient(
        private val origin: OriginKey,
        private val mode: ShellMode,
    ) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (view !== webView) return true
            val url = request.url.toString()
            val decision = if (request.isForMainFrame) {
                SelfOSSecurityPolicy.decideMainFrameNavigation(
                    origin, url, request.hasGesture() && !request.isRedirect,
                )
            } else {
                SelfOSSecurityPolicy.decideSubframeNavigation(origin, url)
            }
            if (decision is NavigationOutcome.OPEN_EXTERNAL) openExternal(decision.url)
            return decision != NavigationOutcome.ALLOW
        }

        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            if (mode == ShellMode.LOCAL) {
                if (request.method != "GET") return blockedResponse()
                val path = when (val asset = SelfOSAssetRouting.resolveWebAsset(request.url.toString())) {
                    is AssetResolution.File -> asset.assetPath
                    AssetResolution.SpaFallback -> "web/index.html"
                    AssetResolution.Blocked -> return blockedResponse()
                }
                val assetUrl = Uri.Builder().scheme("https").authority(LOCAL_ASSET_HOST).path("/$path").build()
                return assetLoader.shouldInterceptRequest(assetUrl) ?: emptyResponse(404, "Not Found")
            }
            // This callback also covers cross-origin initial POST and frame requests.
            // Use the origin captured for this WebView, since this callback runs on a worker.
            return if (SelfOSSecurityPolicy.decideSubframeNavigation(origin, request.url.toString()) ==
                NavigationOutcome.ALLOW
            ) null else blockedResponse()
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            if (view !== webView) return
            cancelFileSelection()
            bridge?.cancelUnfinished()
            if (SelfOSSecurityPolicy.decideMainFrameNavigation(origin, url, false) != NavigationOutcome.ALLOW) {
                // Covers main-document transitions the navigation callback does not report.
                showFailure(view, null)
                closeWebView()
                return
            }
            failedUrl = url.takeIf(::isSameOrigin)
            showScreen(Screen.Loading)
            applyWebInsets()
        }

        override fun onPageCommitVisible(view: WebView, url: String) = showPage(view, url)

        override fun onPageFinished(view: WebView, url: String) = showPage(view, url)

        private fun showPage(view: WebView, url: String) {
            if (view !== webView || view.url != url || screen == Screen.Error) return
            if (SelfOSSecurityPolicy.decideMainFrameNavigation(origin, url, false) != NavigationOutcome.ALLOW) return
            if (screen != Screen.Web) showScreen(Screen.Web)
            applyWebInsets()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showFailure(view, request.url.toString())
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
            if (request.isForMainFrame) showFailure(view, request.url.toString())
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            if (error.url == view.url || error.url == failedUrl) showFailure(view, error.url)
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            if (view === webView) {
                showFailure(view, null)
                closeWebView()
            }
            return true
        }
    }

    private inner class WorkspaceChrome : WebChromeClient() {
        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, message: Message): Boolean {
            if (!trustedPage(view) || popupViews.isNotEmpty()) return false
            val transport = message.obj as? WebView.WebViewTransport ?: return false
            val popup = WebView(this@MainActivity)
            popupViews.add(popup)
            popup.settings.apply {
                blockNetworkLoads = true
                allowFileAccess = false
                allowContentAccess = false
            }
            popup.webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(child: WebView, request: WebResourceRequest): Boolean {
                    if (!request.isForMainFrame) return true
                    val url = request.url.toString()
                    if (url == "about:blank") return false
                    val decision = SelfOSSecurityPolicy.decideNewWindowNavigation(
                        appOrigin, url, isUserGesture && !request.isRedirect,
                    )
                    root.post {
                        if (closePopup(child) && trustedPage(view)) {
                            when (decision) {
                                is NavigationOutcome.LOAD_IN_CURRENT -> view.loadUrl(decision.url)
                                is NavigationOutcome.OPEN_EXTERNAL -> openExternal(decision.url)
                                else -> Unit
                            }
                        }
                    }
                    return true
                }

                override fun shouldInterceptRequest(child: WebView, request: WebResourceRequest): WebResourceResponse =
                    blockedResponse()

                override fun onRenderProcessGone(child: WebView, detail: RenderProcessGoneDetail): Boolean {
                    closePopup(child)
                    return true
                }
            }
            transport.webView = popup
            message.sendToTarget()
            root.postDelayed({ closePopup(popup) }, 5_000)
            return true
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            if (!trustedPage(view) || filePickerInFlight ||
                params.mode !in setOf(FileChooserParams.MODE_OPEN, FileChooserParams.MODE_OPEN_MULTIPLE)
            ) {
                callback.onReceiveValue(null)
                return true
            }
            val types = params.acceptTypes.flatMap { it.split(',') }.mapNotNull { raw ->
                val mime = raw.trim().lowercase()
                if (mime.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(mime.drop(1))
                else mime.takeIf(FILE_PICKER_MIME::matches)
            }.distinct()
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                addCategory(Intent.CATEGORY_OPENABLE)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                type = types.singleOrNull() ?: "*/*"
                if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())
                putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
            }
            return try {
                fileCallback = callback
                filePickerInFlight = true
                pickFiles.launch(intent)
                true
            } catch (_: ActivityNotFoundException) {
                filePickerInFlight = false
                cancelFileSelection()
                toast(R.string.file_picker_error)
                true
            } catch (_: SecurityException) {
                filePickerInFlight = false
                cancelFileSelection()
                toast(R.string.file_picker_error)
                true
            }
        }

        override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
            showJsDialog(view, url, message, result, confirmable = false)

        override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
            showJsDialog(view, url, message, result, confirmable = true)

        override fun onJsPrompt(view: WebView, url: String, message: String, defaultValue: String?, result: JsPromptResult): Boolean {
            if (!trustedPage(view) || !isSameOrigin(url)) {
                result.cancel()
                return true
            }
            val input = EditText(themedContext()).apply { setText(defaultValue.orEmpty()) }
            AlertDialog.Builder(themedContext()).setMessage(message).setView(input)
                .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm(input.text.toString()) }
                .setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
                .setOnCancelListener { result.cancel() }.show()
            return true
        }
    }

    private fun closePopup(view: WebView): Boolean {
        if (!popupViews.remove(view)) return false
        view.destroy()
        return true
    }

    private fun showJsDialog(view: WebView, url: String, message: String, result: JsResult, confirmable: Boolean): Boolean {
        if (!trustedPage(view) || !isSameOrigin(url)) {
            result.cancel()
            return true
        }
        val dialog = AlertDialog.Builder(themedContext()).setMessage(message)
            .setPositiveButton(android.R.string.ok) { _, _ -> result.confirm() }
            .setOnCancelListener { result.cancel() }
        if (confirmable) dialog.setNegativeButton(android.R.string.cancel) { _, _ -> result.cancel() }
        dialog.show()
        return true
    }

    private fun isReadableContentUri(uri: Uri): Boolean =
        uri.scheme == "content" && uri.authority != null &&
            hasUriGrant(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)

    private fun hasUriGrant(uri: Uri, flag: Int): Boolean =
        checkUriPermission(uri, Process.myPid(), Process.myUid(), flag) == PackageManager.PERMISSION_GRANTED

    private fun cancelFileSelection() {
        val callback = fileCallback
        fileCallback = null
        callback?.onReceiveValue(null)
    }

    private fun openExternal(url: String) {
        if (!SelfOSSecurityPolicy.isExternalSafeScheme(url)) return
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (_: ActivityNotFoundException) {
            toast(R.string.open_external_error)
        } catch (_: SecurityException) {
            toast(R.string.open_external_error)
        }
    }

    private fun isSameOrigin(url: String?): Boolean = SelfOSSecurityPolicy.isBridgeCallerAllowed(appOrigin, url)

    private fun trustedPage(view: WebView? = webView): Boolean =
        view != null && webView === view && screen != Screen.Error && isSameOrigin(view.url)

    private fun facadeScript(token: String): String = """
        (() => {
            if (window !== window.top) return;
            const native = window.$RAW_BRIDGE_NAME;
            if (!native) return;
            const capability = '$token';
            Object.defineProperty(window, 'SelfOSAndroid', { value: Object.freeze({
                setTheme: theme => native.setTheme(capability, theme),
                isLocalMode: () => native.isLocalMode(capability),
                openEndpointSettings: () => native.openEndpointSettings(capability),
                beginExport: (name, mime) => native.beginExport(capability, name, mime),
                appendExport: (id, chunk) => native.appendExport(capability, id, chunk),
                finishExport: id => native.finishExport(capability, id),
                abortExport: id => native.abortExport(capability, id)
            }) });
            const apply = () => { ${webInsetsScript()} };
            if (document.documentElement) apply();
            else {
                const observer = new MutationObserver(() => {
                    if (!document.documentElement) return;
                    observer.disconnect();
                    apply();
                });
                observer.observe(document, {childList: true});
            }
        })();
    """.trimIndent()

    // WebView exposes annotated objects to every frame. The origin-restricted
    // document-start facade keeps this capability inside the top document.
    internal inner class NativeBridge(private val view: WebView) {
        val token: String = UUID.randomUUID().toString()
        private val ids = mutableSetOf<String>()
        private var closed = false

        @JavascriptInterface
        fun setTheme(capability: String, theme: String) {
            onUiThread(capability, Unit) {
                if (theme == "dark" || theme == "light") {
                    val next = theme == "light"
                    if (lightTheme != next) {
                        lightTheme = next
                        preferences.edit().putString("theme", theme).apply()
                        applyTheme()
                        if (screen != Screen.Web) showScreen(screen)
                    }
                }
            }
        }

        @JavascriptInterface
        fun isLocalMode(capability: String): Boolean =
            onUiThread(capability, false) { shellMode == ShellMode.LOCAL }

        @JavascriptInterface
        fun openEndpointSettings(capability: String) {
            onUiThread(capability, Unit) { showEndpointSettings() }
        }

        @JavascriptInterface
        fun beginExport(capability: String, filename: String, mimeType: String): String =
            onUiThread(capability, "") {
                if (closed || pendingExportId != null) return@onUiThread ""
                try {
                    exports.begin(filename, mimeType)?.also { ids.add(it) }.orEmpty()
                } catch (_: IOException) {
                    ""
                }
            }

        @JavascriptInterface
        fun appendExport(capability: String, id: String, chunk: String): Boolean =
            onUiThread(capability, false) {
                if (id !in ids) return@onUiThread false
                exports.append(id, chunk).also { if (!it) ids.remove(id) }
            }

        @JavascriptInterface
        fun finishExport(capability: String, id: String): Boolean = onUiThread(capability, false) {
            if (pendingExportId != null || filePickerInFlight || id !in ids || !hasWindowFocus()) {
                return@onUiThread false
            }
            ids.remove(id)
            val export = exports.finish(id) ?: return@onUiThread false
            pendingExportId = id
            try {
                createExport.launch(export.filename)
                true
            } catch (_: ActivityNotFoundException) {
                failedToLaunchExport(id)
            } catch (_: SecurityException) {
                failedToLaunchExport(id)
            }
        }

        @JavascriptInterface
        fun abortExport(capability: String, id: String) {
            onUiThread(capability, Unit) { if (ids.remove(id)) exports.abort(id) }
        }

        fun cancelUnfinished() {
            ids.forEach { exports.abort(it) }
            ids.clear()
        }

        fun close() {
            closed = true
            cancelUnfinished()
        }

        private fun <T> onUiThread(capability: String, fallback: T, action: () -> T): T {
            if (capability != token) return fallback
            val invoke = { if (!closed && trustedPage(view)) action() else fallback }
            if (Looper.myLooper() == Looper.getMainLooper()) return invoke()
            val task = FutureTask { invoke() }
            if (!root.post(task)) return fallback
            return try {
                task.get(5, TimeUnit.SECONDS)
            } catch (_: TimeoutException) {
                task.cancel(false)
                fallback
            } catch (_: InterruptedException) {
                task.cancel(false)
                Thread.currentThread().interrupt()
                fallback
            } catch (_: java.util.concurrent.ExecutionException) {
                fallback
            }
        }
    }

    private fun failedToLaunchExport(id: String): Boolean {
        pendingExportId = null
        exports.abort(id)
        toast(R.string.export_error)
        return false
    }

    private fun completeExport(id: String, uri: Uri?) {
        val staged = try {
            exports.finishedExport(id)
        } catch (_: IOException) {
            null
        }
        if (uri == null || staged == null || uri.scheme != "content" ||
            !hasUriGrant(uri, Intent.FLAG_GRANT_WRITE_URI_PERMISSION) || !DocumentsContract.isDocumentUri(this, uri)
        ) {
            if (staged != null) exports.abort(id)
            if (uri != null) toast(R.string.export_error)
            return
        }
        val context = applicationContext
        exportWriter.execute {
            val saved = try {
                val output = context.contentResolver.openOutputStream(uri, "wt") ?: throw IOException()
                output.use { staged.file.inputStream().use { input -> input.copyTo(it) } }
                true
            } catch (_: IOException) {
                false
            } catch (_: SecurityException) {
                false
            } finally {
                exports.abort(id)
            }
            Handler(Looper.getMainLooper()).post {
                Toast.makeText(context, if (saved) R.string.export_success else R.string.export_error, Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun showFailure(view: WebView, url: String?) {
        if (view !== webView) return
        failedUrl = url?.takeIf(::isSameOrigin) ?: failedUrl
        cancelFileSelection()
        bridge?.cancelUnfinished()
        showScreen(Screen.Error)
    }

    private fun showScreen(next: Screen) {
        screen = next
        overlay.removeAllViews()
        overlay.visibility = if (next == Screen.Web) View.GONE else View.VISIBLE
        webView?.importantForAccessibility = if (next == Screen.Web) View.IMPORTANT_FOR_ACCESSIBILITY_AUTO
        else View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
        if (next == Screen.Web || next == Screen.Loading) return

        val context = if (next == Screen.Onboarding) ContextThemeWrapper(this, R.style.Theme_SelfOS) else themedContext()
        val content = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.START
            val spacing = dp(24)
            setPadding(spacing, spacing, spacing, spacing)
        }
        overlay.addView(ScrollView(context).apply {
            isFillViewport = false
            addView(content)
        }, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER))

        val title = if (next == Screen.Onboarding) R.string.connect_title else R.string.connection_error
        content.addView(TextView(context).apply {
            setText(title)
            textSize = 26f
            ViewCompat.setAccessibilityHeading(this, true)
        })
        if (next == Screen.Onboarding) {
            content.addView(Button(context).apply {
                setText(R.string.use_local)
                backgroundTintList = ColorStateList.valueOf(getColor(R.color.shell_light))
                setTextColor(getColor(R.color.shell_dark))
                setOnClickListener { openLocalMode() }
            })
            content.addView(TextView(context).apply { setText(R.string.connect_description) })
            val input = endpointInput(context)
            content.addView(input)
            content.addView(Button(context).apply {
                setText(R.string.connect_action)
                setOnClickListener { saveEndpoint(input, allowDefault = false) }
            })
        } else {
            content.addView(Button(context).apply {
                setText(R.string.retry_connection)
                setOnClickListener { retryWorkspace() }
            })
            content.addView(Button(context).apply {
                setText(R.string.connection_settings)
                setOnClickListener { showEndpointSettings() }
            })
            if (shellMode == ShellMode.REMOTE) content.addView(Button(context).apply {
                setText(R.string.use_local_after_error)
                setOnClickListener { openLocalMode() }
            })
        }
    }

    private fun showEndpointSettings() {
        if (settingsDialog?.isShowing == true || isFinishing || isDestroyed) return
        val context = themedContext()
        val input = endpointInput(context).apply {
            if (defaultEndpoint != null) setHint(R.string.endpoint_default_hint)
            setText(preferences.getString("endpoint", null).orEmpty())
            setSelection(length())
        }
        val padding = dp(20)
        val field = FrameLayout(context).apply {
            setPadding(padding, 0, padding, 0)
            addView(input)
        }
        val dialog = AlertDialog.Builder(context)
            .setTitle(R.string.connection_settings)
            .setView(field)
            .setPositiveButton(R.string.connect_action, null)
            .setNegativeButton(android.R.string.cancel, null)
            .apply {
                if (shellMode != ShellMode.LOCAL) setNeutralButton(R.string.switch_to_local) { _, _ -> openLocalMode() }
            }
            .create()
        settingsDialog = dialog
        dialog.setOnDismissListener { if (settingsDialog === dialog) settingsDialog = null }
        dialog.show()
        dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
            if (saveEndpoint(input, allowDefault = defaultEndpoint != null)) dialog.dismiss()
        }
    }

    private fun endpointInput(context: Context): EditText = EditText(context).apply {
        setSingleLine(true)
        inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
        setHint(R.string.endpoint_hint)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }

    private fun saveEndpoint(input: EditText, allowDefault: Boolean): Boolean {
        val raw = input.text.toString().trim()
        val normalized = SelfOSEndpoint.normalize(raw)
        if (normalized == null && (raw.isNotEmpty() || !allowDefault)) {
            input.error = getString(R.string.endpoint_invalid)
            return false
        }
        preferences.edit().putString("mode", "remote").putString("endpoint", normalized).apply()
        openEndpoint(normalized ?: defaultEndpoint)
        return true
    }

    private fun shellTheme() = if (lightTheme) R.style.Theme_SelfOS_Light else R.style.Theme_SelfOS
    private fun themedContext() = ContextThemeWrapper(this, shellTheme())
    private fun shellColor() = if (lightTheme) getColor(R.color.shell_light) else getColor(R.color.shell_dark)

    private fun applyTheme() {
        val color = shellColor()
        window.setBackgroundDrawableResource(if (lightTheme) R.color.shell_light else R.color.shell_dark)
        root.setBackgroundColor(color)
        overlay.setBackgroundColor(color)
        webView?.setBackgroundColor(color)
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = lightTheme
            isAppearanceLightNavigationBars = lightTheme
        }
    }

    private fun padOverlay() {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
        overlay.setPadding(bars.left, bars.top, bars.right, max(bars.bottom, keyboard.bottom))
    }

    private fun webInsetsScript(): String {
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        val density = resources.displayMetrics.density
        return """
            const root = document.documentElement;
            if (!root) return;
            root.setAttribute('data-android-app', 'true');
            root.style.setProperty('--android-inset-top', '${bars.top / density}px');
            root.style.setProperty('--android-inset-bottom', '${bars.bottom / density}px');
        """.trimIndent()
    }

    private fun applyWebInsets() {
        val view = webView ?: return
        if (!trustedPage(view)) return
        view.evaluateJavascript("(() => { ${webInsetsScript()} })()", null)
    }

    private fun handleShellBack() {
        if (backInFlight) return
        val view = webView
        if (!trustedPage(view) || view == null) {
            handleUnhandledBack(view)
            return
        }
        backInFlight = true
        view.evaluateJavascript("window.__selfOSHandleBack && window.__selfOSHandleBack()") { handled ->
            if (view === webView) {
                backInFlight = false
                if (handled == "true") lastBackPress = -2_000L else handleUnhandledBack(view)
            }
        }
    }

    private fun handleUnhandledBack(view: WebView?) {
        if (view?.canGoBack() == true) {
            lastBackPress = -2_000L
            view.goBack()
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (now - lastBackPress < 2_000) finish()
        else {
            lastBackPress = now
            toast(R.string.back_again_to_exit)
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).roundToInt()
    private fun toast(message: Int) = Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
    private fun matchParent() = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

    companion object {
        private const val ACTION_CONNECTION_SETTINGS = "org.personalcouncil.next.android.CONNECTION_SETTINGS"
        private const val RAW_BRIDGE_NAME = "SelfOSAndroidNative"
        private val FILE_PICKER_MIME = Regex("(?:[a-z0-9!#$&^_.+-]+|\\*)/(?:[a-z0-9!#$&^_.+-]+|\\*)")
        private val exportWriter = Executors.newSingleThreadExecutor()
        private var processExports: ExportStagingStore? = null

        @Synchronized
        private fun exportStore(context: Context): ExportStagingStore =
            processExports ?: ExportStagingStore(File(context.cacheDir, "android-exports")).also { processExports = it }

        private fun blockedResponse() = emptyResponse(403, "Forbidden")

        private fun emptyResponse(status: Int, reason: String) = WebResourceResponse(
            "text/plain", "UTF-8", status, reason, emptyMap(),
            ByteArrayInputStream(byteArrayOf()),
        )
    }
}
