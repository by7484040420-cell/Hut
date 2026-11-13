package com.mochiclone.studio

import android.app.admin.DeviceAdminReceiver
import android.content.Context
import android.content.Intent

class MochiDeviceAdminReceiver : DeviceAdminReceiver() {
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        super.onProfileProvisioningComplete(context, intent)
    }
}
