package com.mochiclone.studio

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.LauncherApps
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.os.UserManager
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.io.File

data class InstalledPhoneApp(
    val name: String,
    val packageName: String,
    val versionName: String,
    val sourceApkPath: String,
    val splitApkPaths: List<String>,
    val totalSizeBytes: Long,
    val iconBitmap: ImageBitmap?,
    val isSystemApp: Boolean,
    val isMochiClone: Boolean
)

object AppScanner {
    private fun drawableToImageBitmap(drawable: Drawable): ImageBitmap? {
        return runCatching {
            val bitmap = if (drawable is BitmapDrawable && drawable.bitmap != null) {
                drawable.bitmap
            } else {
                val w = drawable.intrinsicWidth.coerceAtLeast(96)
                val h = drawable.intrinsicHeight.coerceAtLeast(96)
                Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { bmp ->
                    val canvas = Canvas(bmp)
                    drawable.setBounds(0, 0, canvas.width, canvas.height)
                    drawable.draw(canvas)
                }
            }
            bitmap.asImageBitmap()
        }.getOrNull()
    }

    fun scanInstalledApps(context: Context, includeSystem: Boolean = false): List<InstalledPhoneApp> {
        val pm = context.packageManager
        val apps = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        return apps.mapNotNull { info ->
            val isSystem = (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            val isClone = info.packageName.contains(".mochi")
            if (!includeSystem && isSystem && !isClone) return@mapNotNull null
            if (info.packageName == context.packageName) return@mapNotNull null
            if (pm.getLaunchIntentForPackage(info.packageName) == null) return@mapNotNull null

            val label = pm.getApplicationLabel(info)?.toString()?.trim().orEmpty()
            val pkgInfo = runCatching { pm.getPackageInfo(info.packageName, 0) }.getOrNull()
            val basePath = info.sourceDir.orEmpty()
            val splits = info.splitSourceDirs?.toList().orEmpty()
            val totalSize = (listOf(basePath) + splits)
                .filter { it.isNotEmpty() }
                .sumOf { path -> runCatching { File(path).length() }.getOrDefault(0L) }
            val icon = runCatching { drawableToImageBitmap(pm.getApplicationIcon(info)) }.getOrNull()

            InstalledPhoneApp(
                name = if (label.isNotEmpty()) label else info.packageName,
                packageName = info.packageName,
                versionName = pkgInfo?.versionName ?: "1.0",
                sourceApkPath = basePath,
                splitApkPaths = splits,
                totalSizeBytes = totalSize,
                iconBitmap = icon,
                isSystemApp = isSystem,
                isMochiClone = isClone
            )
        }.sortedBy { it.name.lowercase() }
    }

    fun launchApp(context: Context, packageName: String): Boolean {
        val intent = context.packageManager.getLaunchIntentForPackage(packageName) ?: return false
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
        return true
    }

    fun uninstallApp(context: Context, packageName: String) {
        val intent = Intent(Intent.ACTION_DELETE, Uri.parse("package:$packageName")).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun hasWorkProfile(context: Context): Boolean {
        val um = context.getSystemService(Context.USER_SERVICE) as UserManager
        return um.userProfiles.size > 1
    }

    fun openInWorkProfile(context: Context, packageName: String): Boolean {
        val um = context.getSystemService(Context.USER_SERVICE) as UserManager
        val launcherApps = context.getSystemService(Context.LAUNCHER_APPS_SERVICE) as LauncherApps
        val secondaryUsers = um.userProfiles.drop(1)
        for (user in secondaryUsers) {
            val activities = launcherApps.getActivityList(packageName, user)
            if (activities.isNotEmpty()) {
                launcherApps.startMainActivity(activities[0].componentName, user, null, null)
                return true
            }
        }
        return false
    }
}
