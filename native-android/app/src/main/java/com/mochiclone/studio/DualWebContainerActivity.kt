package com.mochiclone.studio

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteSweep
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

class DualWebContainerActivity : ComponentActivity() {
    companion object {
        const val EXTRA_CLONE_ID = "clone_id"
        const val EXTRA_TITLE = "clone_title"
        const val EXTRA_URL = "clone_url"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val cloneId = intent.getStringExtra(EXTRA_CLONE_ID) ?: "default"
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Dual Container"
        val initialUrl = intent.getStringExtra(EXTRA_URL) ?: "https://web.whatsapp.com"

        // Isolate Chromium profile, cookies, localStorage & IndexedDB per clone ID
        runCatching {
            WebView.setDataDirectorySuffix("mochi_$cloneId")
        }

        setContent {
            var currentUrl by remember { mutableStateOf(initialUrl) }
            var webViewRef by remember { mutableStateOf<WebView?>(null) }

            Scaffold(
                containerColor = Color(0xFF0B0F17),
                topBar = {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(Color(0xFF111827))
                            .statusBarsPadding()
                            .padding(horizontal = 8.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = { finish() }) {
                            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back", tint = Color.White)
                        }
                        Column(modifier = Modifier.weight(1f)) {
                            Text(title, color = Color.White, style = MaterialTheme.typography.titleSmall)
                            Text(
                                text = "Isolated Container · $cloneId",
                                color = Color(0xFF10B981),
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                        IconButton(onClick = { webViewRef?.reload() }) {
                            Icon(Icons.Default.Refresh, contentDescription = "Reload", tint = Color.White)
                        }
                        IconButton(onClick = {
                            CookieManager.getInstance().removeAllCookies(null)
                            webViewRef?.clearCache(true)
                            webViewRef?.reload()
                        }) {
                            Icon(Icons.Default.DeleteSweep, contentDescription = "Wipe Session", tint = Color(0xFFF59E0B))
                        }
                    }
                }
            ) { padding ->
                AndroidView(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding),
                    factory = { ctx ->
                        WebView(ctx).apply {
                            layoutParams = ViewGroup.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                            CookieManager.getInstance().setAcceptCookie(true)
                            CookieManager.getInstance().setAcceptThirdPartyCookies(this, true)
                            settings.javaScriptEnabled = true
                            settings.domStorageEnabled = true
                            settings.databaseEnabled = true
                            settings.useWideViewPort = true
                            settings.loadWithOverviewMode = true
                            settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                            settings.userAgentString =
                                "Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
                            webChromeClient = WebChromeClient()
                            webViewClient = object : WebViewClient() {
                                override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                                    if (url != null && !url.startsWith("http")) {
                                        runCatching {
                                            ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                                        }
                                        return true
                                    }
                                    return false
                                }
                            }
                            loadUrl(currentUrl)
                            webViewRef = this
                        }
                    }
                )
            }
        }
    }
}
