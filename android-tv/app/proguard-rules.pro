# Proguard rules for WilsonTV
# Keep JavaScript Interface methods to prevent them from being obfuscated by R8
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
