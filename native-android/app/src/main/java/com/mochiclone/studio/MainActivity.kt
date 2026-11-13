package com.mochiclone.studio

import android.app.admin.DevicePolicyManager
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apps
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Workspaces
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class DualWebPreset(
    val id: String,
    val title: String,
    val url: String
)

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MochiCloneNativeScreen()
        }
    }
}

private fun formatApkSize(bytes: Long): String {
    val mb = bytes / (1024.0 * 1024.0)
    return String.format("%.1f MB", mb)
}

@Composable
fun MochiCloneNativeScreen() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var selectedTab by remember { mutableIntStateOf(0) }
    var searchQuery by remember { mutableStateOf("") }
    var installedApps by remember { mutableStateOf<List<InstalledPhoneApp>>(emptyList()) }
    var isScanning by remember { mutableStateOf(true) }
    var cloningTarget by remember { mutableStateOf<InstalledPhoneApp?>(null) }
    var cloneNumber by remember { mutableIntStateOf(2) }
    var customLabel by remember { mutableStateOf("") }
    var isCloningBusy by remember { mutableStateOf(false) }
    var workProfileActive by remember { mutableStateOf(AppScanner.hasWorkProfile(context)) }

    fun reloadApps() {
        scope.launch {
            isScanning = true
            val list = withContext(Dispatchers.IO) {
                AppScanner.scanInstalledApps(context)
            }
            installedApps = list
            workProfileActive = AppScanner.hasWorkProfile(context)
            isScanning = false
        }
    }

    LaunchedEffect(Unit) {
        reloadApps()
    }

    DisposableEffect(context) {
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(c: Context?, intent: Intent?) {
                reloadApps()
            }
        }
        val filter = IntentFilter(InstallConfirmReceiver.ACTION_CLONES_CHANGED)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
        onDispose {
            runCatching { context.unregisterReceiver(receiver) }
        }
    }

    val webContainers = remember {
        listOf(
            DualWebPreset("wa_2", "WhatsApp Dual #2", "https://web.whatsapp.com"),
            DualWebPreset("wa_3", "WhatsApp Dual #3", "https://web.whatsapp.com"),
            DualWebPreset("ig_2", "Instagram Account #2", "https://www.instagram.com"),
            DualWebPreset("tg_2", "Telegram Dual #2", "https://web.telegram.org"),
            DualWebPreset("gm_2", "Gmail Work #2", "https://mail.google.com"),
            DualWebPreset("dc_2", "Discord Alt #2", "https://discord.com/app"),
            DualWebPreset("fb_2", "Facebook Dual #2", "https://m.facebook.com")
        )
    }

    val phoneApps = remember(searchQuery, installedApps) {
        val base = installedApps.filter { !it.isMochiClone }
        if (searchQuery.isBlank()) base
        else base.filter {
            it.name.contains(searchQuery, ignoreCase = true) ||
                it.packageName.contains(searchQuery, ignoreCase = true)
        }
    }

    val myClones = remember(installedApps) {
        installedApps.filter { it.isMochiClone }
    }

    Scaffold(
        containerColor = Color(0xFF0B0F17),
        topBar = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF111827))
                    .statusBarsPadding()
                    .padding(16.dp)
            ) {
                Text(
                    "MochiClone",
                    color = Color.White,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Clone Installed Phone APKs · Dual Work Space · Isolated Web",
                    color = Color(0xFF94A3B8),
                    style = MaterialTheme.typography.bodySmall
                )
            }
        },
        bottomBar = {
            NavigationBar(containerColor = Color(0xFF111827)) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.ContentCopy, contentDescription = null) },
                    label = { Text("Phone Apps") }
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.Apps, contentDescription = null) },
                    label = { Text("My Clones") }
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Language, contentDescription = null) },
                    label = { Text("Dual Web") }
                )
                NavigationBarItem(
                    selected = selectedTab == 3,
                    onClick = {
                        workProfileActive = AppScanner.hasWorkProfile(context)
                        selectedTab = 3
                    },
                    icon = { Icon(Icons.Default.Workspaces, contentDescription = null) },
                    label = { Text("Dual Space") }
                )
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            if (selectedTab == 0) {
                OutlinedTextField(
                    value = searchQuery,
                    onValueChange = { searchQuery = it },
                    placeholder = { Text("Search installed apps on your phone...") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
                Spacer(modifier = Modifier.height(12.dp))
                if (isScanning) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(color = Color(0xFF10B981))
                    }
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(phoneApps, key = { it.packageName }) { app ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF111827), RoundedCornerShape(16.dp))
                                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(16.dp))
                                    .padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (app.iconBitmap != null) {
                                    Image(
                                        bitmap = app.iconBitmap,
                                        contentDescription = app.name,
                                        modifier = Modifier
                                            .size(44.dp)
                                            .clip(RoundedCornerShape(12.dp))
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(app.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        "${app.packageName} · ${formatApkSize(app.totalSizeBytes)}",
                                        color = Color(0xFF94A3B8),
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                                Spacer(modifier = Modifier.width(8.dp))
                                Button(
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = Color(0xFF10B981),
                                        contentColor = Color(0xFF06281E)
                                    ),
                                    onClick = {
                                        val existingCount = installedApps.count {
                                            it.packageName.startsWith("${app.packageName}.mochi")
                                        }
                                        cloneNumber = existingCount + 2
                                        customLabel = "${app.name} #${existingCount + 2}"
                                        cloningTarget = app
                                    }
                                ) {
                                    Text("Clone")
                                }
                            }
                        }
                    }
                }
            } else if (selectedTab == 1) {
                if (myClones.isEmpty()) {
                    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                        Text(
                            "No cloned apps installed yet. Open Phone Apps and tap Clone on any app.",
                            color = Color(0xFF94A3B8)
                        )
                    }
                } else {
                    LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(myClones, key = { it.packageName }) { clone ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF111827), RoundedCornerShape(16.dp))
                                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(16.dp))
                                    .padding(14.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                if (clone.iconBitmap != null) {
                                    Image(
                                        bitmap = clone.iconBitmap,
                                        contentDescription = clone.name,
                                        modifier = Modifier
                                            .size(44.dp)
                                            .clip(RoundedCornerShape(12.dp))
                                    )
                                    Spacer(modifier = Modifier.width(12.dp))
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(clone.name, color = Color.White, fontWeight = FontWeight.SemiBold)
                                    Text(
                                        clone.packageName,
                                        color = Color(0xFF10B981),
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                                IconButton(onClick = { AppScanner.launchApp(context, clone.packageName) }) {
                                    Icon(Icons.Default.PlayArrow, contentDescription = "Open Clone", tint = Color(0xFF10B981))
                                }
                                IconButton(onClick = { AppScanner.uninstallApp(context, clone.packageName) }) {
                                    Icon(Icons.Default.Delete, contentDescription = "Uninstall", tint = Color(0xFFF43F5E))
                                }
                            }
                        }
                    }
                }
            } else if (selectedTab == 2) {
                Text(
                    "Each container uses isolated WebView.setDataDirectorySuffix() storage so dual accounts stay logged in separately.",
                    color = Color(0xFF94A3B8),
                    style = MaterialTheme.typography.bodySmall
                )
                Spacer(modifier = Modifier.height(12.dp))
                LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(webContainers, key = { it.id }) { item ->
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFF111827), RoundedCornerShape(16.dp))
                                .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(16.dp))
                                .padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(item.title, color = Color.White, fontWeight = FontWeight.SemiBold)
                                Text(item.url, color = Color(0xFF94A3B8), style = MaterialTheme.typography.bodySmall)
                            }
                            Button(
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF10B981),
                                    contentColor = Color(0xFF06281E)
                                ),
                                onClick = {
                                    val intent = Intent(context, DualWebContainerActivity::class.java).apply {
                                        putExtra(DualWebContainerActivity.EXTRA_CLONE_ID, item.id)
                                        putExtra(DualWebContainerActivity.EXTRA_TITLE, item.title)
                                        putExtra(DualWebContainerActivity.EXTRA_URL, item.url)
                                    }
                                    context.startActivity(intent)
                                }
                            ) {
                                Text("Launch")
                            }
                        }
                    }
                }
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF111827), RoundedCornerShape(16.dp))
                        .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(16.dp))
                        .padding(18.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        if (workProfileActive) "Android Dual Work Space Active" else "Create Android Dual Work Space",
                        color = Color.White,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        "Work Profile runs a genuine second system sandbox on your phone for apps with strict anti-tamper protection (WhatsApp, BGMI, Banking apps) with zero root.",
                        color = Color(0xFF94A3B8),
                        style = MaterialTheme.typography.bodySmall
                    )
                    Button(
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF10B981),
                            contentColor = Color(0xFF06281E)
                        ),
                        onClick = {
                            val intent = Intent(DevicePolicyManager.ACTION_PROVISION_MANAGED_PROFILE).apply {
                                putExtra(
                                    DevicePolicyManager.EXTRA_PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME,
                                    ComponentName(context, MochiDeviceAdminReceiver::class.java)
                                )
                            }
                            runCatching { context.startActivity(intent) }.onFailure {
                                Toast.makeText(context, "Work Profile provisioning not supported on this ROM", Toast.LENGTH_LONG).show()
                            }
                        }
                    ) {
                        Text(if (workProfileActive) "Refresh Dual Space" else "Setup Dual Work Space")
                    }
                }
            }
        }
    }

    cloningTarget?.let { target ->
        AlertDialog(
            onDismissRequest = { if (!isCloningBusy) cloningTarget = null },
            containerColor = Color(0xFF111827),
            title = { Text("Clone ${target.name}", color = Color.White) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Package: ${target.packageName}.mochi$cloneNumber",
                        color = Color(0xFF10B981),
                        style = MaterialTheme.typography.bodySmall
                    )
                    OutlinedTextField(
                        value = customLabel,
                        onValueChange = { customLabel = it },
                        label = { Text("Clone App Name") },
                        singleLine = true
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf(2, 3, 4, 5).forEach { num ->
                            FilterChip(
                                selected = cloneNumber == num,
                                onClick = {
                                    cloneNumber = num
                                    customLabel = "${target.name} #$num"
                                },
                                label = { Text("#$num") }
                            )
                        }
                    }
                }
            },
            confirmButton = {
                Button(
                    enabled = !isCloningBusy,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF10B981),
                        contentColor = Color(0xFF06281E)
                    ),
                    onClick = {
                        if (!OnDeviceApkCloner.canRequestInstalls(context)) {
                            OnDeviceApkCloner.openInstallPermissionSettings(context)
                            Toast.makeText(context, "Allow 'Install unknown apps' for MochiClone, then tap Install Clone again.", Toast.LENGTH_LONG).show()
                            return@Button
                        }
                        isCloningBusy = true
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                OnDeviceApkCloner.cloneAndInstallApp(
                                    context = context,
                                    app = target,
                                    newPackage = "${target.packageName}.mochi$cloneNumber",
                                    newAppLabel = customLabel
                                )
                            }
                            isCloningBusy = false
                            result.onSuccess {
                                cloningTarget = null
                            }.onFailure { err ->
                                Toast.makeText(context, err.message ?: "Clone failed", Toast.LENGTH_LONG).show()
                            }
                        }
                    }
                ) {
                    Text(if (isCloningBusy) "Cloning..." else "Install Clone")
                }
            },
            dismissButton = {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (workProfileActive) {
                        TextButton(onClick = {
                            if (!AppScanner.openInWorkProfile(context, target.packageName)) {
                                Toast.makeText(context, "Install inside Work Profile Play Store first", Toast.LENGTH_SHORT).show()
                            }
                            cloningTarget = null
                        }) {
                            Text("Dual Space", color = Color(0xFF38BDF8))
                        }
                    }
                    TextButton(enabled = !isCloningBusy, onClick = { cloningTarget = null }) {
                        Text("Cancel", color = Color(0xFF94A3B8))
                    }
                }
            }
        )
    }
}
