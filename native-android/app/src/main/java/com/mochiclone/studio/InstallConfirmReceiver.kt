package com.mochiclone.studio

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.widget.Toast

class InstallConfirmReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_INSTALL_STATUS = "com.mochiclone.studio.INSTALL_STATUS"
        const val ACTION_CLONES_CHANGED = "com.mochiclone.studio.CLONES_CHANGED"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirmIntent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirmIntent != null) {
                    confirmIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    context.startActivity(confirmIntent)
                }
            }
            PackageInstaller.STATUS_SUCCESS -> {
                Toast.makeText(context, "Clone installed successfully!", Toast.LENGTH_SHORT).show()
                context.sendBroadcast(Intent(ACTION_CLONES_CHANGED).setPackage(context.packageName))
            }
            PackageInstaller.STATUS_FAILURE_ABORTED -> {
                Toast.makeText(context, "Installation cancelled", Toast.LENGTH_SHORT).show()
            }
            else -> {
                val msg = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE) ?: "Install failed ($status)"
                Toast.makeText(context, msg, Toast.LENGTH_LONG).show()
            }
        }
    }
}
