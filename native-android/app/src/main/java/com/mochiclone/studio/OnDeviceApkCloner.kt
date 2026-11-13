package com.mochiclone.studio

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.android.apksig.ApkSigner
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.Date
import java.util.zip.CRC32
import java.util.zip.ZipEntry
import java.util.zip.ZipFile
import java.util.zip.ZipOutputStream

object OnDeviceApkCloner {
    fun canRequestInstalls(context: Context): Boolean {
        return context.packageManager.canRequestPackageInstalls()
    }

    fun openInstallPermissionSettings(context: Context) {
        val intent = Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:${context.packageName}")
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    fun cloneAndInstallApp(
        context: Context,
        app: InstalledPhoneApp,
        newPackage: String,
        newAppLabel: String?
    ): Result<Unit> = runCatching {
        val allApkPaths = listOf(app.sourceApkPath) + app.splitApkPaths
        val validFiles = allApkPaths.filter { it.isNotEmpty() }.map { File(it) }
        require(validFiles.isNotEmpty() && validFiles.all { it.exists() && it.canRead() }) {
            "Cannot read installed APK files for ${app.name}"
        }

        val workDir = File(context.cacheDir, "cloned_apks").apply { mkdirs() }
        workDir.listFiles()?.forEach { it.delete() }

        val signedApks = validFiles.mapIndexed { index, srcFile ->
            val unsignedFile = File(workDir, "unsigned_$index.apk")
            val signedFile = File(workDir, "signed_$index.apk")
            rewriteApkManifest(
                srcFile = srcFile,
                outFile = unsignedFile,
                origPkg = app.packageName,
                newPkg = newPackage,
                newLabel = if (index == 0) newAppLabel else null
            )
            signApkWithApksig(unsignedFile, signedFile)
            unsignedFile.delete()
            signedFile
        }

        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)

        session.use { s ->
            signedApks.forEachIndexed { idx, apkFile ->
                val splitName = if (idx == 0) "base.apk" else "split_$idx.apk"
                s.openWrite(splitName, 0, apkFile.length()).use { out ->
                    apkFile.inputStream().use { input ->
                        input.copyTo(out)
                    }
                    s.fsync(out)
                }
            }

            val callbackIntent = Intent(context, InstallConfirmReceiver::class.java).apply {
                action = InstallConfirmReceiver.ACTION_INSTALL_STATUS
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val pendingIntent = PendingIntent.getBroadcast(context, sessionId, callbackIntent, flags)
            s.commit(pendingIntent.intentSender)
        }
    }

    private fun rewriteApkManifest(
        srcFile: File,
        outFile: File,
        origPkg: String,
        newPkg: String,
        newLabel: String?
    ) {
        ZipFile(srcFile).use { zipIn ->
            ZipOutputStream(FileOutputStream(outFile)).use { zipOut ->
                val entries = zipIn.entries()
                while (entries.hasMoreElements()) {
                    val entry = entries.nextElement()
                    val name = entry.name
                    if (
                        name.startsWith("META-INF/") &&
                        (name.endsWith(".SF") || name.endsWith(".RSA") || name.endsWith(".DSA") || name.endsWith(".EC") || name == "META-INF/MANIFEST.MF")
                    ) {
                        continue
                    }

                    val rawBytes = zipIn.getInputStream(entry).readBytes()
                    val finalBytes = if (name == "AndroidManifest.xml") {
                        patchAxmlManifest(rawBytes, origPkg, newPkg, newLabel)
                    } else {
                        rawBytes
                    }

                    val outEntry = ZipEntry(name)
                    if (name == "resources.arsc" || name.endsWith(".so")) {
                        outEntry.method = ZipEntry.STORED
                        outEntry.size = finalBytes.size.toLong()
                        outEntry.compressedSize = finalBytes.size.toLong()
                        val crc = CRC32().apply { update(finalBytes) }
                        outEntry.crc = crc.value
                    }
                    zipOut.putNextEntry(outEntry)
                    zipOut.write(finalBytes)
                    zipOut.closeEntry()
                }
            }
        }
    }

    private fun patchAxmlManifest(
        buf: ByteArray,
        origPkg: String,
        newPkg: String,
        newLabel: String?
    ): ByteArray {
        val bb = ByteBuffer.wrap(buf).order(ByteOrder.LITTLE_ENDIAN)
        if (bb.getShort(0).toInt() != 0x0003) return buf
        val poolOffset = 8
        if (bb.getShort(poolOffset).toInt() != 0x0001) return buf

        val headerSize = bb.getShort(poolOffset + 2).toInt() and 0xFFFF
        val oldChunkSize = bb.getInt(poolOffset + 4)
        val stringCount = bb.getInt(poolOffset + 8)
        val styleCount = bb.getInt(poolOffset + 12)
        val flags = bb.getInt(poolOffset + 16)
        val stringsStart = bb.getInt(poolOffset + 20)
        val stylesStart = bb.getInt(poolOffset + 24)
        val isUtf8 = (flags and 0x0100) != 0

        val strings = MutableList(stringCount) { "" }
        val offsetsBase = poolOffset + headerSize
        val absStringsStart = poolOffset + stringsStart

        for (i in 0 until stringCount) {
            var p = absStringsStart + bb.getInt(offsetsBase + i * 4)
            if (isUtf8) {
                val b0 = buf[p++].toInt() and 0xFF
                if ((b0 and 0x80) != 0) p++
                var u8Len = buf[p++].toInt() and 0xFF
                if ((u8Len and 0x80) != 0) {
                    u8Len = ((u8Len and 0x7F) shl 8) or (buf[p++].toInt() and 0xFF)
                }
                strings[i] = String(buf, p, u8Len, Charsets.UTF_8)
            } else {
                var len = bb.getShort(p).toInt() and 0xFFFF
                p += 2
                if ((len and 0x8000) != 0) {
                    len = ((len and 0x7FFF) shl 16) or (bb.getShort(p).toInt() and 0xFFFF)
                    p += 2
                }
                strings[i] = String(buf, p, len * 2, Charsets.UTF_16LE)
            }
        }

        // Find literal application label string index if present
        var labelIdx: Int? = null
        var pos = poolOffset + oldChunkSize
        while (pos + 8 <= buf.size) {
            val cType = bb.getShort(pos).toInt() and 0xFFFF
            val cHeader = bb.getShort(pos + 2).toInt() and 0xFFFF
            val cSize = bb.getInt(pos + 4)
            if (cSize < 8 || pos + cSize > buf.size) break
            if (cType == 0x0102 && pos + 36 <= buf.size) {
                val tagIdx = bb.getInt(pos + 20)
                val tagName = if (tagIdx in strings.indices) strings[tagIdx] else ""
                if (tagName == "application") {
                    val attrStart = bb.getShort(pos + 24).toInt() and 0xFFFF
                    val attrSize = (bb.getShort(pos + 26).toInt() and 0xFFFF).coerceAtLeast(20)
                    val attrCount = bb.getShort(pos + 28).toInt() and 0xFFFF
                    val attrsBase = pos + cHeader + attrStart
                    for (a in 0 until attrCount) {
                        val ap = attrsBase + a * attrSize
                        if (ap + 20 > buf.size) break
                        val nIdx = bb.getInt(ap + 4)
                        val attrName = if (nIdx in strings.indices) strings[nIdx] else ""
                        val dataType = buf[ap + 15].toInt() and 0xFF
                        val rawIdx = bb.getInt(ap + 8)
                        val data = bb.getInt(ap + 16)
                        if (attrName == "label" && dataType == 0x03) {
                            val idx = if (rawIdx >= 0) rawIdx else data
                            if (idx in strings.indices) labelIdx = idx
                        }
                    }
                }
            }
            pos += cSize
        }

        for (i in strings.indices) {
            val s = strings[i]
            if (s == origPkg) {
                strings[i] = newPkg
            } else if (s.startsWith("$origPkg.") && !s.startsWith("android.")) {
                strings[i] = "$newPkg.${s.removePrefix("$origPkg.")}"
            }
        }
        if (!newLabel.isNullOrBlank() && labelIdx != null) {
            strings[labelIdx] = newLabel.trim()
        }

        val strOut = ByteArrayOutputStream()
        val newOffsets = IntArray(stringCount)
        for (i in 0 until stringCount) {
            newOffsets[i] = strOut.size()
            val s = strings[i]
            if (isUtf8) {
                val utf8 = s.toByteArray(Charsets.UTF_8)
                writeVarInt(strOut, s.length)
                writeVarInt(strOut, utf8.size)
                strOut.write(utf8)
                strOut.write(0)
            } else {
                val utf16 = s.toByteArray(Charsets.UTF_16LE)
                writeLen16(strOut, s.length)
                strOut.write(utf16)
                strOut.write(0)
                strOut.write(0)
            }
        }
        while (strOut.size() % 4 != 0) strOut.write(0)

        val rawStrings = strOut.toByteArray()
        val styleOffsetsBytes = if (styleCount > 0) {
            buf.copyOfRange(offsetsBase + stringCount * 4, offsetsBase + stringCount * 4 + styleCount * 4)
        } else ByteArray(0)
        val stylesDataBytes = if (styleCount > 0 && stylesStart > 0) {
            buf.copyOfRange(poolOffset + stylesStart, poolOffset + oldChunkSize)
        } else ByteArray(0)

        val newStringsStart = headerSize + stringCount * 4 + styleCount * 4
        val newStylesStart = if (styleCount > 0 && stylesDataBytes.isNotEmpty()) newStringsStart + rawStrings.size else 0
        var newChunkSize = newStringsStart + rawStrings.size + stylesDataBytes.size
        val pad = (4 - (newChunkSize % 4)) % 4
        newChunkSize += pad

        val tail = buf.copyOfRange(poolOffset + oldChunkSize, buf.size)
        val totalSize = 8 + newChunkSize + tail.size
        val out = ByteBuffer.allocate(totalSize).order(ByteOrder.LITTLE_ENDIAN)

        out.put(buf, 0, 8)
        out.putInt(4, totalSize)
        out.putShort(0x0001)
        out.putShort(headerSize.toShort())
        out.putInt(newChunkSize)
        out.putInt(stringCount)
        out.putInt(styleCount)
        out.putInt(flags)
        out.putInt(newStringsStart)
        out.putInt(newStylesStart)
        newOffsets.forEach { out.putInt(it) }
        out.put(styleOffsetsBytes)
        out.put(rawStrings)
        out.put(stylesDataBytes)
        repeat(pad) { out.put(0) }
        out.put(tail)
        return out.array()
    }

    private fun writeVarInt(out: ByteArrayOutputStream, v: Int) {
        if (v < 0x80) out.write(v) else {
            out.write(((v ushr 8) and 0x7F) or 0x80)
            out.write(v and 0xFF)
        }
    }

    private fun writeLen16(out: ByteArrayOutputStream, v: Int) {
        if (v < 0x8000) {
            out.write(v and 0xFF)
            out.write((v ushr 8) and 0xFF)
        } else {
            val hi = ((v ushr 16) and 0x7FFF) or 0x8000
            val lo = v and 0xFFFF
            out.write(hi and 0xFF); out.write((hi ushr 8) and 0xFF)
            out.write(lo and 0xFF); out.write((lo ushr 8) and 0xFF)
        }
    }

    private fun signApkWithApksig(inputApk: File, outputApk: File) {
        val ksAlias = "mochi_signer_v2"
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        if (!ks.containsAlias(ksAlias)) {
            val kpg = KeyPairGenerator.getInstance("RSA", "AndroidKeyStore")
            val spec = android.security.keystore.KeyGenParameterSpec.Builder(
                ksAlias,
                android.security.keystore.KeyProperties.PURPOSE_SIGN
            )
                .setKeySize(2048)
                .setDigests(
                    android.security.keystore.KeyProperties.DIGEST_SHA1,
                    android.security.keystore.KeyProperties.DIGEST_SHA256,
                    android.security.keystore.KeyProperties.DIGEST_SHA512
                )
                .setSignaturePaddings(android.security.keystore.KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                .setCertificateSubject(javax.security.auth.x500.X500Principal("CN=MochiClone"))
                .setCertificateSerialNumber(BigInteger.valueOf(System.currentTimeMillis()))
                .setCertificateNotBefore(Date(System.currentTimeMillis() - 86400000L))
                .setCertificateNotAfter(Date(System.currentTimeMillis() + 3650L * 86400000L))
                .build()
            kpg.initialize(spec)
            kpg.generateKeyPair()
        }

        val privateKey = ks.getKey(ksAlias, null) as PrivateKey
        val cert = ks.getCertificate(ksAlias) as X509Certificate
        val signerConfig = ApkSigner.SignerConfig.Builder("MOCHI", privateKey, listOf(cert)).build()

        ApkSigner.Builder(listOf(signerConfig))
            .setInputApk(inputApk)
            .setOutputApk(outputApk)
            .setV1SigningEnabled(true)
            .setV2SigningEnabled(true)
            .setV3SigningEnabled(false)
            .build()
            .sign()
    }
}
