package com.example.wilsontv

import android.app.Activity
import android.os.Bundle
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : Activity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        // Web settings for TV player
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true

        // CORS support for local files making requests to https://iptv.90s.agency
        settings.allowFileAccessFromFileURLs = true
        settings.allowUniversalAccessFromFileURLs = true

        // Allow playing HTTP streams (non-HTTPS) inside the webapp context
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // WebChromeClient is required for HTML5 video, alerts, etc.
        webView.webChromeClient = WebChromeClient()

        // Handle internal navigation within the WebView itself
        webView.webViewClient = object : WebViewClient() {
            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false
            }
        }

        // JavaScript Interface for app closing
        webView.addJavascriptInterface(object {
            @JavascriptInterface
            fun exit() {
                runOnUiThread {
                    finish()
                }
            }
        }, "AndroidApp")

        // Load the local app inside assets
        webView.loadUrl("file:///android_asset/index.html")
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        // Redirect physical Back button to Escape (27) key in Javascript
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ESCAPE))
            webView.dispatchKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ESCAPE))
            return true
        }
        return super.onKeyDown(keyCode, event)
    }
}
