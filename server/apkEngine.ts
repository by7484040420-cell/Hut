import crypto from 'crypto';
import zlib from 'zlib';
import AdmZip from 'adm-zip';
import forge from 'node-forge';

export interface ParsedApkManifest {
  packageName: string;
  versionName: string;
  versionCode: number;
  minSdkVersion: number | null;
  targetSdkVersion: number | null;
  appLabel: string | null;
  appLabelIsResource: boolean;
  permissions: string[];
  authorities: string[];
  activitiesCount: number;
  servicesCount: number;
  receiversCount: number;
}

export interface ApkInspectionSummary {
  fileName: string;
  sizeBytes: number;
  sha256: string;
  hasResourcesArsc: boolean;
  dexFiles: string[];
  nativeAbis: string[];
  manifest: ParsedApkManifest;
}

export interface CloneApkOptions {
  newPackageName: string;
  newAppLabel?: string;
  renameAuthorities?: boolean;
  renameCustomPermissions?: boolean;
}

interface ParsedStringPool {
  flags: number;
  isUtf8: boolean;
  headerSize: number;
  oldChunkSize: number;
  styleCount: number;
  strings: string[];
  styleOffsetsBuf: Buffer;
  stylesDataBuf: Buffer;
}

function readVarIntUtf8(buf: Buffer, offset: number): { value: number; next: number } {
  const b0 = buf[offset];
  if ((b0 & 0x80) === 0) {
    return { value: b0, next: offset + 1 };
  }
  const b1 = buf[offset + 1];
  return { value: ((b0 & 0x7f) << 8) | b1, next: offset + 2 };
}

function readLenUtf16(buf: Buffer, offset: number): { value: number; next: number } {
  const s0 = buf.readUInt16LE(offset);
  if ((s0 & 0x8000) === 0) {
    return { value: s0, next: offset + 2 };
  }
  const s1 = buf.readUInt16LE(offset + 2);
  return { value: ((s0 & 0x7fff) << 16) | s1, next: offset + 4 };
}

function writeVarIntUtf8(val: number): Buffer {
  if (val < 0x80) {
    return Buffer.from([val]);
  }
  return Buffer.from([((val >> 8) & 0x7f) | 0x80, val & 0xff]);
}

function writeLenUtf16(val: number): Buffer {
  if (val < 0x8000) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(val, 0);
    return b;
  }
  const b = Buffer.alloc(4);
  b.writeUInt16LE(((val >> 16) & 0x7fff) | 0x8000, 0);
  b.writeUInt16LE(val & 0xffff, 2);
  return b;
}

function parseStringPool(buf: Buffer, poolOffset = 8): ParsedStringPool {
  const chunkType = buf.readUInt16LE(poolOffset);
  if (chunkType !== 0x0001) {
    throw new Error(`Expected RES_STRING_POOL_TYPE (0x0001), got 0x${chunkType.toString(16)}`);
  }
  const headerSize = buf.readUInt16LE(poolOffset + 2);
  const chunkSize = buf.readUInt32LE(poolOffset + 4);
  const stringCount = buf.readUInt32LE(poolOffset + 8);
  const styleCount = buf.readUInt32LE(poolOffset + 12);
  const flags = buf.readUInt32LE(poolOffset + 16);
  const stringsStart = buf.readUInt32LE(poolOffset + 20);
  const stylesStart = buf.readUInt32LE(poolOffset + 24);
  const isUtf8 = (flags & 0x0100) !== 0;

  const offsetsBase = poolOffset + headerSize;
  const stringsAbsStart = poolOffset + stringsStart;
  const strings: string[] = [];

  for (let i = 0; i < stringCount; i++) {
    const strOffset = buf.readUInt32LE(offsetsBase + i * 4);
    let p = stringsAbsStart + strOffset;
    if (isUtf8) {
      const u16 = readVarIntUtf8(buf, p);
      p = u16.next;
      const u8 = readVarIntUtf8(buf, p);
      p = u8.next;
      strings.push(buf.subarray(p, p + u8.value).toString('utf8'));
    } else {
      const len = readLenUtf16(buf, p);
      p = len.next;
      strings.push(buf.subarray(p, p + len.value * 2).toString('utf16le'));
    }
  }

  const styleOffsetsStart = offsetsBase + stringCount * 4;
  const styleOffsetsBuf =
    styleCount > 0
      ? Buffer.from(buf.subarray(styleOffsetsStart, styleOffsetsStart + styleCount * 4))
      : Buffer.alloc(0);

  const stylesDataBuf =
    styleCount > 0 && stylesStart > 0
      ? Buffer.from(buf.subarray(poolOffset + stylesStart, poolOffset + chunkSize))
      : Buffer.alloc(0);

  return {
    flags,
    isUtf8,
    headerSize,
    oldChunkSize: chunkSize,
    styleCount,
    strings,
    styleOffsetsBuf,
    stylesDataBuf,
  };
}

function rebuildAxmlWithStrings(originalBuf: Buffer, pool: ParsedStringPool, newStrings: string[]): Buffer {
  const poolOffset = 8;
  const stringCount = newStrings.length;
  const encodedChunks: Buffer[] = [];
  const newOffsets = Buffer.alloc(stringCount * 4);
  let cursor = 0;

  for (let i = 0; i < stringCount; i++) {
    newOffsets.writeUInt32LE(cursor, i * 4);
    const s = newStrings[i];
    if (pool.isUtf8) {
      const utf8Buf = Buffer.from(s, 'utf8');
      const u16LenBuf = writeVarIntUtf8(s.length);
      const u8LenBuf = writeVarIntUtf8(utf8Buf.length);
      const entry = Buffer.concat([u16LenBuf, u8LenBuf, utf8Buf, Buffer.from([0])]);
      encodedChunks.push(entry);
      cursor += entry.length;
    } else {
      const utf16Buf = Buffer.from(s, 'utf16le');
      const lenBuf = writeLenUtf16(s.length);
      const entry = Buffer.concat([lenBuf, utf16Buf, Buffer.from([0, 0])]);
      encodedChunks.push(entry);
      cursor += entry.length;
    }
  }

  const rawStringsData = Buffer.concat(encodedChunks);
  const strPadLen = (4 - (rawStringsData.length % 4)) % 4;
  const paddedStringsData =
    strPadLen > 0 ? Buffer.concat([rawStringsData, Buffer.alloc(strPadLen)]) : rawStringsData;

  const stringsStart = pool.headerSize + stringCount * 4 + pool.styleCount * 4;
  const stylesStart =
    pool.styleCount > 0 && pool.stylesDataBuf.length > 0 ? stringsStart + paddedStringsData.length : 0;

  const unpaddedChunkSize =
    stringsStart + paddedStringsData.length + pool.stylesDataBuf.length;
  const chunkPadLen = (4 - (unpaddedChunkSize % 4)) % 4;
  const newChunkSize = unpaddedChunkSize + chunkPadLen;

  const headerBuf = Buffer.alloc(pool.headerSize);
  headerBuf.writeUInt16LE(0x0001, 0);
  headerBuf.writeUInt16LE(pool.headerSize, 2);
  headerBuf.writeUInt32LE(newChunkSize, 4);
  headerBuf.writeUInt32LE(stringCount, 8);
  headerBuf.writeUInt32LE(pool.styleCount, 12);
  headerBuf.writeUInt32LE(pool.flags, 16);
  headerBuf.writeUInt32LE(stringsStart, 20);
  headerBuf.writeUInt32LE(stylesStart, 24);

  const newPoolBuf = Buffer.concat([
    headerBuf,
    newOffsets,
    pool.styleOffsetsBuf,
    paddedStringsData,
    pool.stylesDataBuf,
    chunkPadLen > 0 ? Buffer.alloc(chunkPadLen) : Buffer.alloc(0),
  ]);

  const rootHeader = Buffer.from(originalBuf.subarray(0, 8));
  const tailBuf = Buffer.from(originalBuf.subarray(poolOffset + pool.oldChunkSize));
  const fullBuf = Buffer.concat([rootHeader, newPoolBuf, tailBuf]);
  fullBuf.writeUInt32LE(fullBuf.length, 4);
  return fullBuf;
}

interface ManifestStringRefs {
  parsed: ParsedApkManifest;
  packageStrIdx: number | null;
  appLabelStrIdx: number | null;
  authorityStrIndices: number[];
  customPermissionStrIndices: number[];
}

function inspectAxmlBuffer(buf: Buffer): { pool: ParsedStringPool; refs: ManifestStringRefs } {
  if (buf.length < 16 || buf.readUInt16LE(0) !== 0x0003) {
    throw new Error('Invalid Android binary XML (AndroidManifest.xml)');
  }
  const pool = parseStringPool(buf, 8);
  const strings = pool.strings;

  let packageName = '';
  let versionName = '1.0';
  let versionCode = 1;
  let minSdkVersion: number | null = null;
  let targetSdkVersion: number | null = null;
  let appLabel: string | null = null;
  let appLabelIsResource = false;
  const permissions: string[] = [];
  const authorities: string[] = [];
  let activitiesCount = 0;
  let servicesCount = 0;
  let receiversCount = 0;

  let packageStrIdx: number | null = null;
  let appLabelStrIdx: number | null = null;
  const authorityStrIndices: number[] = [];
  const customPermissionStrIndices: number[] = [];

  let pos = 8 + pool.oldChunkSize;
  while (pos + 8 <= buf.length) {
    const chunkType = buf.readUInt16LE(pos);
    const chunkHeaderSize = buf.readUInt16LE(pos + 2);
    const chunkSize = buf.readUInt32LE(pos + 4);
    if (chunkSize < 8 || pos + chunkSize > buf.length) break;

    if (chunkType === 0x0102 && pos + 36 <= buf.length) {
      const tagNameIdx = buf.readInt32LE(pos + 20);
      const tagName = tagNameIdx >= 0 && tagNameIdx < strings.length ? strings[tagNameIdx] : '';
      const attrStart = buf.readUInt16LE(pos + 24);
      const attrSize = buf.readUInt16LE(pos + 26) || 20;
      const attrCount = buf.readUInt16LE(pos + 28);

      if (tagName === 'activity' || tagName === 'activity-alias') activitiesCount++;
      if (tagName === 'service') servicesCount++;
      if (tagName === 'receiver') receiversCount++;

      const attrsBase = pos + chunkHeaderSize + attrStart;
      for (let a = 0; a < attrCount; a++) {
        const ap = attrsBase + a * attrSize;
        if (ap + 20 > buf.length) break;
        const nameIdx = buf.readInt32LE(ap + 4);
        const rawValIdx = buf.readInt32LE(ap + 8);
        const dataType = buf.readUInt8(ap + 15);
        const data = buf.readUInt32LE(ap + 16);
        const attrName = nameIdx >= 0 && nameIdx < strings.length ? strings[nameIdx] : '';

        const getStrVal = (): { val: string; idx: number } | null => {
          const idx = rawValIdx >= 0 ? rawValIdx : dataType === 0x03 ? data : -1;
          if (idx >= 0 && idx < strings.length) {
            return { val: strings[idx], idx };
          }
          return null;
        };

        if (tagName === 'manifest') {
          if (attrName === 'package') {
            const sv = getStrVal();
            if (sv) {
              packageName = sv.val;
              packageStrIdx = sv.idx;
            }
          } else if (attrName === 'versionCode') {
            versionCode = data;
          } else if (attrName === 'versionName') {
            const sv = getStrVal();
            versionName = sv ? sv.val : String(data);
          }
        } else if (tagName === 'uses-sdk') {
          if (attrName === 'minSdkVersion') minSdkVersion = data;
          if (attrName === 'targetSdkVersion') targetSdkVersion = data;
        } else if (tagName === 'application') {
          if (attrName === 'label') {
            if (dataType === 0x03) {
              const sv = getStrVal();
              if (sv) {
                appLabel = sv.val;
                appLabelStrIdx = sv.idx;
              }
            } else if (dataType === 0x01) {
              appLabelIsResource = true;
              appLabel = `@0x${data.toString(16)}`;
            }
          }
        } else if (tagName === 'uses-permission' || tagName === 'permission') {
          if (attrName === 'name') {
            const sv = getStrVal();
            if (sv) {
              if (tagName === 'uses-permission') permissions.push(sv.val);
              customPermissionStrIndices.push(sv.idx);
            }
          }
        } else if (tagName === 'provider') {
          if (attrName === 'authorities') {
            const sv = getStrVal();
            if (sv) {
              authorities.push(sv.val);
              authorityStrIndices.push(sv.idx);
            }
          }
        }
      }
    }

    pos += chunkSize;
  }

  return {
    pool,
    refs: {
      parsed: {
        packageName: packageName || 'unknown.package',
        versionName,
        versionCode,
        minSdkVersion,
        targetSdkVersion,
        appLabel,
        appLabelIsResource,
        permissions: Array.from(new Set(permissions)),
        authorities: Array.from(new Set(authorities)),
        activitiesCount,
        servicesCount,
        receiversCount,
      },
      packageStrIdx,
      appLabelStrIdx,
      authorityStrIndices,
      customPermissionStrIndices,
    },
  };
}

function normalizeApkInputBuffer(inputBuffer: Buffer): Buffer {
  const outerZip = new AdmZip(inputBuffer);
  if (outerZip.getEntry('AndroidManifest.xml')) {
    return inputBuffer;
  }
  const innerApks = outerZip
    .getEntries()
    .filter((e) => !e.isDirectory && e.entryName.toLowerCase().endsWith('.apk'));
  if (innerApks.length === 0) {
    throw new Error('This file does not contain AndroidManifest.xml or any base .apk');
  }
  const baseEntry =
    innerApks.find((e) => e.entryName.toLowerCase().endsWith('base.apk')) ||
    innerApks.sort((a, b) => b.header.size - a.header.size)[0];
  return baseEntry.getData();
}

export function inspectRealApkBuffer(fileName: string, rawBuffer: Buffer): ApkInspectionSummary {
  const apkBuffer = normalizeApkInputBuffer(rawBuffer);
  const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');
  const zip = new AdmZip(apkBuffer);
  const entries = zip.getEntries();

  const manifestEntry = zip.getEntry('AndroidManifest.xml');
  if (!manifestEntry) {
    throw new Error('This file does not contain AndroidManifest.xml (not a valid APK)');
  }
  const manifestBuf = manifestEntry.getData();
  const { refs } = inspectAxmlBuffer(manifestBuf);

  const dexFiles: string[] = [];
  const abiSet = new Set<string>();
  let hasResourcesArsc = false;

  for (const entry of entries) {
    if (entry.entryName === 'resources.arsc') hasResourcesArsc = true;
    if (/^classes\d*\.dex$/.test(entry.entryName)) dexFiles.push(entry.entryName);
    const libMatch = entry.entryName.match(/^lib\/([^/]+)\//);
    if (libMatch) abiSet.add(libMatch[1]);
  }

  return {
    fileName,
    sizeBytes: apkBuffer.length,
    sha256,
    hasResourcesArsc,
    dexFiles: dexFiles.sort(),
    nativeAbis: Array.from(abiSet).sort(),
    manifest: refs.parsed,
  };
}

// ---- Signing Certificate Cache ----
let cachedCertPair: {
  privateKeyPem: string;
  publicKeyDer: Buffer;
  certDer: Buffer;
  forgeKey: forge.pki.rsa.PrivateKey;
  forgeCert: forge.pki.Certificate;
} | null = null;

function getOrCreateSigningIdentity() {
  if (cachedCertPair) return cachedCertPair;

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + crypto.randomBytes(6).toString('hex');
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 25);

  const attrs = [
    { name: 'commonName', value: 'MochiClone Signer' },
    { name: 'organizationName', value: 'MochiClone Studio' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certAsn1 = forge.pki.certificateToAsn1(cert);
  const certDerBytes = forge.asn1.toDer(certAsn1).getBytes();
  const certDer = Buffer.from(certDerBytes, 'binary');

  const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);
  const certPem = forge.pki.certificateToPem(cert);
  const pubKeyDer = crypto
    .createPublicKey(certPem)
    .export({ type: 'spki', format: 'der' }) as Buffer;

  cachedCertPair = {
    privateKeyPem,
    publicKeyDer: pubKeyDer,
    certDer,
    forgeKey: keys.privateKey,
    forgeCert: cert,
  };
  return cachedCertPair;
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createPkcs7Signature(sfBytes: Buffer): Buffer {
  const id = getOrCreateSigningIdentity();
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(sfBytes.toString('binary'));
  p7.addCertificate(id.forgeCert);
  p7.addSigner({
    key: id.forgeKey,
    certificate: id.forgeCert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [],
  });
  p7.sign({ detached: true });
  const derBytes = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(derBytes, 'binary');
}

function lengthPrefixed(buf: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32LE(buf.length, 0);
  return Buffer.concat([len, buf]);
}

function computeApkV2Digest(entriesBuf: Buffer, cdBuf: Buffer, eocdForDigest: Buffer): Buffer {
  const chunkDigests: Buffer[] = [];
  const CHUNK_SIZE = 1048576;

  const processSection = (section: Buffer) => {
    for (let offset = 0; offset < section.length; offset += CHUNK_SIZE) {
      const slice = section.subarray(offset, Math.min(section.length, offset + CHUNK_SIZE));
      const header = Buffer.alloc(5);
      header[0] = 0xa5;
      header.writeUInt32LE(slice.length, 1);
      chunkDigests.push(crypto.createHash('sha256').update(header).update(slice).digest());
    }
  };

  processSection(entriesBuf);
  processSection(cdBuf);
  processSection(eocdForDigest);

  const topHeader = Buffer.alloc(5);
  topHeader[0] = 0x5a;
  topHeader.writeUInt32LE(chunkDigests.length, 1);
  return crypto
    .createHash('sha256')
    .update(topHeader)
    .update(Buffer.concat(chunkDigests))
    .digest();
}

function buildApkSigningBlockV2(entriesBuf: Buffer, cdBuf: Buffer, eocdForDigest: Buffer): Buffer {
  const id = getOrCreateSigningIdentity();
  const digest = computeApkV2Digest(entriesBuf, cdBuf, eocdForDigest);
  const SIG_ALG_RSA_PKCS1_SHA256 = 0x0103;

  const algBuf = Buffer.alloc(4);
  algBuf.writeUInt32LE(SIG_ALG_RSA_PKCS1_SHA256, 0);

  const digestEntry = Buffer.concat([algBuf, lengthPrefixed(digest)]);
  const digestsSeq = lengthPrefixed(lengthPrefixed(digestEntry));
  const certsSeq = lengthPrefixed(lengthPrefixed(id.certDer));
  const additionalAttrs = Buffer.alloc(4); // 0 bytes

  const signedData = Buffer.concat([digestsSeq, certsSeq, additionalAttrs]);

  const signerSignature = crypto
    .createSign('RSA-SHA256')
    .update(signedData)
    .sign(id.privateKeyPem);

  const sigEntry = Buffer.concat([algBuf, lengthPrefixed(signerSignature)]);
  const signaturesSeq = lengthPrefixed(lengthPrefixed(sigEntry));

  const signer = Buffer.concat([
    lengthPrefixed(signedData),
    signaturesSeq,
    lengthPrefixed(id.publicKeyDer),
  ]);

  const v2Value = lengthPrefixed(lengthPrefixed(signer));

  const pairLen = Buffer.alloc(8);
  pairLen.writeBigUInt64LE(BigInt(4 + v2Value.length), 0);
  const pairId = Buffer.alloc(4);
  pairId.writeUInt32LE(0x7109871a, 0);

  const v2Pair = Buffer.concat([pairLen, pairId, v2Value]);

  const blockSizeExclFirst8 = BigInt(v2Pair.length + 8 + 16);
  const sizeBuf = Buffer.alloc(8);
  sizeBuf.writeBigUInt64LE(blockSizeExclFirst8, 0);
  const magic = Buffer.from('APK Sig Block 42', 'ascii');

  return Buffer.concat([sizeBuf, v2Pair, sizeBuf, magic]);
}

interface ZipWriteEntry {
  name: string;
  data: Buffer;
  storeUncompressed: boolean;
  alignBytes: number;
}

function buildAlignedSignedApk(zipEntries: ZipWriteEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const entry of zipEntries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const uncompressedSize = entry.data.length;

    let method = 8; // deflate
    let payload = entry.data;
    if (entry.storeUncompressed || entry.data.length === 0) {
      method = 0;
      payload = entry.data;
    } else {
      const deflated = zlib.deflateRawSync(entry.data, { level: 6 });
      if (deflated.length < entry.data.length) {
        payload = deflated;
      } else {
        method = 0;
      }
    }

    // 4-byte (or 4096-byte for .so) alignment for stored uncompressed files
    let extraBuf = Buffer.alloc(0);
    if (method === 0 && entry.alignBytes > 1) {
      const headerBaseLen = 30 + nameBuf.length;
      const remainder = (offset + headerBaseLen) % entry.alignBytes;
      if (remainder !== 0) {
        const pad = entry.alignBytes - remainder;
        extraBuf = Buffer.alloc(pad);
      }
    }

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4); // version needed
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 flag
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x5421, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(payload.length, 18);
    lfh.writeUInt32LE(uncompressedSize, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(extraBuf.length, 28);

    localParts.push(lfh, nameBuf, extraBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x5421, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(uncompressedSize, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);

    cdParts.push(cd, nameBuf);
    offset += lfh.length + nameBuf.length + extraBuf.length + payload.length;
  }

  const entriesBuf = Buffer.concat(localParts);
  const cdBuf = Buffer.concat(cdParts);

  const eocdBase = Buffer.alloc(22);
  eocdBase.writeUInt32LE(0x06054b50, 0);
  eocdBase.writeUInt16LE(0, 4);
  eocdBase.writeUInt16LE(0, 6);
  eocdBase.writeUInt16LE(zipEntries.length, 8);
  eocdBase.writeUInt16LE(zipEntries.length, 10);
  eocdBase.writeUInt32LE(cdBuf.length, 12);
  eocdBase.writeUInt32LE(entriesBuf.length, 16);
  eocdBase.writeUInt16LE(0, 20);

  const signingBlock = buildApkSigningBlockV2(entriesBuf, cdBuf, eocdBase);

  const finalEocd = Buffer.from(eocdBase);
  finalEocd.writeUInt32LE(entriesBuf.length + signingBlock.length, 16);

  return Buffer.concat([entriesBuf, signingBlock, cdBuf, finalEocd]);
}

export function cloneAndSignApkBuffer(
  rawBuffer: Buffer,
  options: CloneApkOptions
): { signedApk: Buffer; originalManifest: ParsedApkManifest; clonedPackageName: string } {
  const newPkg = options.newPackageName.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(newPkg)) {
    throw new Error(
      'Invalid Android package ID. Use reverse-domain format like com.example.app.clone2'
    );
  }

  const apkBuffer = normalizeApkInputBuffer(rawBuffer);
  const zip = new AdmZip(apkBuffer);
  const manifestEntry = zip.getEntry('AndroidManifest.xml');
  if (!manifestEntry) {
    throw new Error('Missing AndroidManifest.xml inside uploaded APK');
  }

  const oldManifestBuf = manifestEntry.getData();
  const { pool, refs } = inspectAxmlBuffer(oldManifestBuf);
  const origPkg = refs.parsed.packageName;
  const newStrings = [...pool.strings];

  if (refs.packageStrIdx !== null) {
    newStrings[refs.packageStrIdx] = newPkg;
  }

  if (options.newAppLabel && options.newAppLabel.trim() && refs.appLabelStrIdx !== null) {
    newStrings[refs.appLabelStrIdx] = options.newAppLabel.trim();
  }

  if (options.renameAuthorities !== false) {
    for (const idx of refs.authorityStrIndices) {
      const val = newStrings[idx];
      if (val.startsWith(`${origPkg}.`)) {
        newStrings[idx] = `${newPkg}.${val.slice(origPkg.length + 1)}`;
      } else if (val === origPkg) {
        newStrings[idx] = newPkg;
      } else {
        newStrings[idx] = `${val}.mochi`;
      }
    }
  }

  if (options.renameCustomPermissions !== false) {
    for (const idx of refs.customPermissionStrIndices) {
      const val = newStrings[idx];
      if (val.startsWith(`${origPkg}.`) && !val.startsWith('android.permission.')) {
        newStrings[idx] = `${newPkg}.${val.slice(origPkg.length + 1)}`;
      }
    }
  }

  const patchedManifestBuf = rebuildAxmlWithStrings(oldManifestBuf, pool, newStrings);

  // Collect all non-signature entries and compute v1 MANIFEST.MF + CERT.SF
  const contentEntries: ZipWriteEntry[] = [];
  const manifestHeader = [
    'Manifest-Version: 1.0',
    'Created-By: MochiClone APK Engine 2.0',
    '',
    '',
  ].join('\r\n');
  const manifestBlocks: string[] = [];
  const sfSectionLines: string[] = [];

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    if (
      name === 'META-INF/MANIFEST.MF' ||
      /^META-INF\/.*\.(SF|RSA|DSA|EC)$/i.test(name)
    ) {
      continue;
    }

    const data = name === 'AndroidManifest.xml' ? patchedManifestBuf : entry.getData();
    const isArsc = name === 'resources.arsc';
    const isNativeLib = name.endsWith('.so');
    const isUncompressedAsset = /\.(png|jpg|jpeg|webp|mp3|ogg|wav|mp4|ttf|otf)$/i.test(name);

    contentEntries.push({
      name,
      data,
      storeUncompressed: isArsc || isNativeLib || isUncompressedAsset,
      alignBytes: isNativeLib ? 4096 : isArsc ? 4 : 1,
    });

    const sha256B64 = crypto.createHash('sha256').update(data).digest('base64');
    const entryBlock = `Name: ${name}\r\nSHA-256-Digest: ${sha256B64}\r\n\r\n`;
    manifestBlocks.push(entryBlock);

    const entryBlockSha256 = crypto
      .createHash('sha256')
      .update(Buffer.from(entryBlock, 'utf8'))
      .digest('base64');
    sfSectionLines.push(`Name: ${name}\r\nSHA-256-Digest: ${entryBlockSha256}\r\n\r\n`);
  }

  const manifestMfText = manifestHeader + manifestBlocks.join('');
  const manifestMfBuf = Buffer.from(manifestMfText, 'utf8');
  const manifestWholeDigest = crypto.createHash('sha256').update(manifestMfBuf).digest('base64');

  const sfHeader = [
    'Signature-Version: 1.0',
    `SHA-256-Digest-Manifest: ${manifestWholeDigest}`,
    'Created-By: MochiClone APK Signer 2.0',
    'X-Android-APK-Signed: 2',
    '',
  ].join('\r\n');

  const sfBuf = Buffer.from(sfHeader + '\r\n' + sfSectionLines.join(''), 'utf8');
  const certRsaBuf = createPkcs7Signature(sfBuf);

  const allEntries: ZipWriteEntry[] = [
    ...contentEntries,
    { name: 'META-INF/MANIFEST.MF', data: manifestMfBuf, storeUncompressed: false, alignBytes: 1 },
    { name: 'META-INF/CERT.SF', data: sfBuf, storeUncompressed: false, alignBytes: 1 },
    { name: 'META-INF/CERT.RSA', data: certRsaBuf, storeUncompressed: false, alignBytes: 1 },
  ];

  const signedApk = buildAlignedSignedApk(allEntries);

  return {
    signedApk,
    originalManifest: refs.parsed,
    clonedPackageName: newPkg,
  };
}
