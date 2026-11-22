export interface PdfPageJpegInput {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
}

export interface ConvertedPdfResult {
  blob: Blob;
  kb: number;
  pageCount: number;
  quality: number;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/**
 * Pure TypeScript zero-dependency PDF-1.4 binary writer embedding JPEG (DCTDecode) images.
 * Creates real multi-page A4-scaled PDFs directly in browser RAM.
 */
export function buildJpegPdfBlob(pages: PdfPageJpegInput[]): Blob {
  if (pages.length === 0) {
    throw new Error('At least one image page is required to build PDF.');
  }

  const encoder = new TextEncoder();
  const strBytes = (s: string) => encoder.encode(s);

  // Each page needs: Page object, Content stream object, Image XObject -> 3 objects per page
  // Object 1: Catalog, Object 2: Pages
  const pageObjIds: number[] = [];
  const objChunks: Map<number, Uint8Array> = new Map();

  let nextId = 3;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const pageId = nextId++;
    const contentId = nextId++;
    const imageId = nextId++;
    pageObjIds.push(pageId);

    // Fit image inside standard A4 points (595.28 x 841.89) with 24pt margin
    const a4W = 595.28;
    const a4H = 841.89;
    const margin = 24;
    const maxW = a4W - margin * 2;
    const maxH = a4H - margin * 2;
    const ratio = Math.min(maxW / Math.max(1, p.width), maxH / Math.max(1, p.height));
    const drawW = Number((p.width * ratio).toFixed(2));
    const drawH = Number((p.height * ratio).toFixed(2));
    const x = Number(((a4W - drawW) / 2).toFixed(2));
    const y = Number(((a4H - drawH) / 2).toFixed(2));

    const contentStream = `q\n${drawW} 0 0 ${drawH} ${x} ${y} cm\n/Im0 Do\nQ\n`;
    const contentBytes = strBytes(contentStream);

    objChunks.set(
      pageId,
      strBytes(
        `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${a4W} ${a4H}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
      )
    );

    objChunks.set(
      contentId,
      concatUint8Arrays([
        strBytes(`${contentId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
        contentBytes,
        strBytes(`\nendstream\nendobj\n`),
      ])
    );

    objChunks.set(
      imageId,
      concatUint8Arrays([
        strBytes(
          `${imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpegBytes.length} >>\nstream\n`
        ),
        p.jpegBytes,
        strBytes(`\nendstream\nendobj\n`),
      ])
    );
  }

  objChunks.set(1, strBytes(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`));
  objChunks.set(
    2,
    strBytes(
      `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjIds.length} >>\nendobj\n`
    )
  );

  const totalObjects = nextId - 1;
  const header = strBytes(`%PDF-1.4\n%\xE2\xE3\xCF\xD3\n`);
  const parts: Uint8Array[] = [header];
  const offsets: number[] = [0];
  let cursor = header.length;

  for (let id = 1; id <= totalObjects; id++) {
    offsets[id] = cursor;
    const chunk = objChunks.get(id)!;
    parts.push(chunk);
    cursor += chunk.length;
  }

  const xrefOffset = cursor;
  const xrefLines = [`xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`];
  for (let id = 1; id <= totalObjects; id++) {
    xrefLines.push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  }
  xrefLines.push(
    `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );
  parts.push(strBytes(xrefLines.join('')));

  const pdfBytes = concatUint8Arrays(parts);
  const exactBuffer = pdfBytes.buffer.slice(
    pdfBytes.byteOffset,
    pdfBytes.byteOffset + pdfBytes.byteLength
  ) as ArrayBuffer;
  return new Blob([exactBuffer], { type: 'application/pdf' });
}

async function loadHtmlImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image file.'));
    img.src = dataUrl;
  });
}

async function renderScaledJpegBytes(
  img: HTMLImageElement,
  maxEdge: number,
  quality: number
): Promise<PdfPageJpegInput> {
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(120, Math.round(img.naturalWidth * scale));
  const height = Math.max(120, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable.');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      quality
    );
  });
  const buf = await blob.arrayBuffer();
  return { jpegBytes: new Uint8Array(buf), width, height };
}

/**
 * Compresses 1..N scanned document images into a single valid PDF under maxTotalKb.
 */
export async function convertImagesToUnderKbPdf(
  dataUrls: string[],
  maxTotalKb: number
): Promise<ConvertedPdfResult> {
  const imgs = await Promise.all(dataUrls.map((u) => loadHtmlImage(u)));
  const targetBytes = Math.max(35, maxTotalKb) * 1024;

  // Try quality binary search first at clean readable A4-scan resolution, then step down resolution if multi-page requires
  const edgeSteps = imgs.length > 2 ? [1100, 880, 700] : [1350, 1050, 820, 640];
  let bestBlob: Blob | null = null;
  let bestQuality = 0.72;

  for (const edge of edgeSteps) {
    let low = 0.18;
    let high = 0.9;
    for (let iter = 0; iter < 6; iter++) {
      const mid = (low + high) / 2;
      const rendered = await Promise.all(imgs.map((img) => renderScaledJpegBytes(img, edge, mid)));
      const pdfBlob = buildJpegPdfBlob(rendered);
      if (!bestBlob || (pdfBlob.size <= targetBytes && bestBlob.size > targetBytes) || (pdfBlob.size <= targetBytes && pdfBlob.size > bestBlob.size) || (bestBlob.size > targetBytes && pdfBlob.size < bestBlob.size)) {
        bestBlob = pdfBlob;
        bestQuality = mid;
      }
      if (pdfBlob.size <= targetBytes) {
        low = mid;
      } else {
        high = mid;
      }
    }
    if (bestBlob && bestBlob.size <= targetBytes) {
      break;
    }
  }

  const finalBlob = bestBlob!;
  return {
    blob: finalBlob,
    kb: Math.round((finalBlob.size / 1024) * 10) / 10,
    pageCount: imgs.length,
    quality: Math.round(bestQuality * 100),
  };
}

/**
 * Generates a crisp 4x6 printable passport sheet containing 6 or 8 copies with light cut guides.
 */
export async function buildPassportPhotoSheetDataUrl(
  photoDataUrl: string,
  count: 6 | 8
): Promise<string> {
  const img = await loadHtmlImage(photoDataUrl);
  // 4x6 inch landscape-ish or portrait 300 DPI sheet -> 1200x1800 px for 6/8 copies
  const sheetW = 1200;
  const sheetH = 1800;
  const canvas = document.createElement('canvas');
  canvas.width = sheetW;
  canvas.height = sheetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable.');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, sheetW, sheetH);

  const cols = 2;
  const rows = count === 8 ? 4 : 3;
  const padX = 85;
  const padY = count === 8 ? 75 : 105;
  const gapX = 70;
  const gapY = count === 8 ? 45 : 75;
  const cellW = Math.floor((sheetW - padX * 2 - gapX * (cols - 1)) / cols);
  const cellH = Math.floor((sheetH - padY * 2 - gapY * (rows - 1)) / rows);

  // Target passport aspect ~ 3.5cm x 4.5cm (7:9)
  const targetAspect = 35 / 45;
  let drawBoxW = cellW;
  let drawBoxH = Math.round(cellW / targetAspect);
  if (drawBoxH > cellH) {
    drawBoxH = cellH;
    drawBoxW = Math.round(cellH * targetAspect);
  }

  const imgScale = Math.max(drawBoxW / img.naturalWidth, drawBoxH / img.naturalHeight);
  const srcDrawW = drawBoxW / imgScale;
  const srcDrawH = drawBoxH / imgScale;
  const srcX = (img.naturalWidth - srcDrawW) / 2;
  const srcY = (img.naturalHeight - srcDrawH) / 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const boxX = padX + c * (cellW + gapX) + Math.round((cellW - drawBoxW) / 2);
      const boxY = padY + r * (cellH + gapY) + Math.round((cellH - drawBoxH) / 2);

      ctx.drawImage(img, srcX, srcY, srcDrawW, srcDrawH, boxX, boxY, drawBoxW, drawBoxH);

      ctx.save();
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(boxX - 2, boxY - 2, drawBoxW + 4, drawBoxH + 4);
      ctx.restore();
    }
  }

  return canvas.toDataURL('image/jpeg', 0.94);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Exports a clean UTF-8 Word (.doc) file openable in MS Word, LibreOffice, and WPS Office on Android.
 */
export function downloadWordDoc(params: {
  filename: string;
  title: string;
  subtitle?: string;
  bodyText: string;
  secondaryTitle?: string;
  secondaryText?: string;
}): void {
  const safeName = params.filename.endsWith('.doc') ? params.filename : `${params.filename}.doc`;
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(params.title)}</title>
<style>
  @page { size: A4; margin: 20mm; }
  body { font-family: 'Mangal', 'Nirmala UI', 'Calibri', sans-serif; font-size: 11.5pt; line-height: 1.6; color: #111827; }
  h1 { font-size: 14pt; margin: 0 0 6pt 0; border-bottom: 1px solid #cbd5e1; padding-bottom: 4pt; }
  .meta { font-size: 9.5pt; color: #475569; margin-bottom: 14pt; }
  pre { font-family: 'Mangal', 'Nirmala UI', 'Calibri', sans-serif; white-space: pre-wrap; word-wrap: break-word; margin: 0 0 16pt 0; }
  h2 { font-size: 12pt; margin: 16pt 0 6pt 0; border-top: 1px solid #e2e8f0; padding-top: 10pt; }
</style>
</head>
<body>
  <h1>${escapeHtml(params.title)}</h1>
  ${params.subtitle ? `<div class="meta">${escapeHtml(params.subtitle)}</div>` : ''}
  <pre>${escapeHtml(params.bodyText)}</pre>
  ${
    params.secondaryText?.trim()
      ? `<h2>${escapeHtml(params.secondaryTitle || 'Supporting Draft')}</h2><pre>${escapeHtml(params.secondaryText)}</pre>`
      : ''
  }
</body>
</html>`;

  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  a.click();
  URL.revokeObjectURL(url);
}

export type LandUnitId =
  | 'sqft'
  | 'sqm'
  | 'dismil'
  | 'acre'
  | 'hectare'
  | 'dhur'
  | 'kattha'
  | 'bigha';

export const LAND_UNIT_LABELS: Array<{ id: LandUnitId; label: string }> = [
  { id: 'dismil', label: 'Dismil (Decimal)' },
  { id: 'kattha', label: 'Kattha' },
  { id: 'bigha', label: 'Bigha' },
  { id: 'dhur', label: 'Dhur' },
  { id: 'sqft', label: 'Square Feet (Sq Ft)' },
  { id: 'sqm', label: 'Square Meter (Sq M)' },
  { id: 'acre', label: 'Acre' },
  { id: 'hectare', label: 'Hectare' },
];

/**
 * Accurate Indian revenue area conversion (1 Acre = 43560 sq ft = 100 Dismil; 1 Laggi = laggiHath * 1.5 ft -> 1 Dhur = laggi^2 sq ft; 20 Dhur = 1 Kattha; 20 Kattha = 1 Bigha).
 */
export function convertLandArea(
  value: number,
  unit: LandUnitId,
  laggiHath = 5.5
): Record<LandUnitId, number> {
  const safeVal = Number.isFinite(value) && value >= 0 ? value : 0;
  const laggiFeet = Math.max(3, laggiHath) * 1.5; // 1 hath = 1.5 feet (18 inches)
  const dhurSqFt = laggiFeet * laggiFeet;
  const katthaSqFt = dhurSqFt * 20;
  const bighaSqFt = katthaSqFt * 20;

  const factorToSqFt: Record<LandUnitId, number> = {
    sqft: 1,
    sqm: 10.7639104167,
    dismil: 435.6,
    acre: 43560,
    hectare: 107639.104167,
    dhur: dhurSqFt,
    kattha: katthaSqFt,
    bigha: bighaSqFt,
  };

  const sqFt = safeVal * factorToSqFt[unit];
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return {
    sqft: r(sqFt / factorToSqFt.sqft),
    sqm: r(sqFt / factorToSqFt.sqm),
    dismil: r(sqFt / factorToSqFt.dismil),
    acre: r(sqFt / factorToSqFt.acre),
    hectare: r(sqFt / factorToSqFt.hectare),
    dhur: r(sqFt / factorToSqFt.dhur),
    kattha: r(sqFt / factorToSqFt.kattha),
    bigha: r(sqFt / factorToSqFt.bigha),
  };
}

export interface LegalSectionRef {
  bnsOrBnss: string;
  oldIpcOrCrpc: string;
  lawCode: 'BNS' | 'BNSS' | 'NI Act';
  title: string;
  hindiMeaning: string;
  bailNote: string;
}

export const BNS_IPC_QUICK_REF: LegalSectionRef[] = [
  {
    bnsOrBnss: 'BNS 115(2)',
    oldIpcOrCrpc: 'IPC 323',
    lawCode: 'BNS',
    title: 'Voluntarily Causing Hurt (Maar-peet / Chot)',
    hindiMeaning: 'Sadharan maar-peet ya chot pahunchana',
    bailNote: 'Bailable (Jamanati)',
  },
  {
    bnsOrBnss: 'BNS 117(2)',
    oldIpcOrCrpc: 'IPC 325',
    lawCode: 'BNS',
    title: 'Grievous Hurt (Haddi tootna / Gambhir chot)',
    hindiMeaning: 'Gambhir chot ya haddi fracture karna',
    bailNote: 'Bailable (up to 7 yrs)',
  },
  {
    bnsOrBnss: 'BNS 351(2)(3)',
    oldIpcOrCrpc: 'IPC 506',
    lawCode: 'BNS',
    title: 'Criminal Intimidation (Jaan se marne ki dhamki)',
    hindiMeaning: 'Dhamkana ya darana',
    bailNote: 'Bailable / Non-Cog',
  },
  {
    bnsOrBnss: 'BNS 352',
    oldIpcOrCrpc: 'IPC 504',
    lawCode: 'BNS',
    title: 'Intentional Insult / Gaali-galauj (Shanti bhang)',
    hindiMeaning: 'Bhadkane ke liye gaali ya beizzati',
    bailNote: 'Bailable',
  },
  {
    bnsOrBnss: 'BNS 303(2)',
    oldIpcOrCrpc: 'IPC 379',
    lawCode: 'BNS',
    title: 'Theft (Chori)',
    hindiMeaning: 'Kisi ki sampatti ya gadi chori karna',
    bailNote: 'Non-Bailable (Court bail)',
  },
  {
    bnsOrBnss: 'BNS 318(4)',
    oldIpcOrCrpc: 'IPC 420',
    lawCode: 'BNS',
    title: 'Cheating & Dishonesty (Dhokhadhadi / Thagi)',
    hindiMeaning: 'Paisa ya jamin me dhokhadhadi karna',
    bailNote: 'Non-Bailable',
  },
  {
    bnsOrBnss: 'BNS 336 / 338',
    oldIpcOrCrpc: 'IPC 465 / 467 / 468',
    lawCode: 'BNS',
    title: 'Forgery of Valuable Document / Kewala (Jali kagaz)',
    hindiMeaning: 'Farzi registry, kewala ya dastavez banana',
    bailNote: 'Non-Bailable',
  },
  {
    bnsOrBnss: 'BNS 329',
    oldIpcOrCrpc: 'IPC 447 / 448',
    lawCode: 'BNS',
    title: 'Criminal Trespass (Jamin / Ghar me zabardasti ghusna)',
    hindiMeaning: 'Bina ijazat dusre ki jamin ya makan me ghusna',
    bailNote: 'Bailable',
  },
  {
    bnsOrBnss: 'BNS 109',
    oldIpcOrCrpc: 'IPC 307',
    lawCode: 'BNS',
    title: 'Attempt to Murder (Jaanlewa hamla)',
    hindiMeaning: 'Hatya ki koshish',
    bailNote: 'Non-Bailable (Sessions)',
  },
  {
    bnsOrBnss: 'BNS 103(1)',
    oldIpcOrCrpc: 'IPC 302',
    lawCode: 'BNS',
    title: 'Murder (Hatya)',
    hindiMeaning: 'Hatya ka mukadma',
    bailNote: 'Non-Bailable (Sessions)',
  },
  {
    bnsOrBnss: 'BNSS 126 / 129',
    oldIpcOrCrpc: 'CrPC 107 / 116',
    lawCode: 'BNSS',
    title: 'SDM Security Bond for Keeping Peace (107 Notice)',
    hindiMeaning: 'Jamin ya gaon vivad me SDM shanti bond notice',
    bailNote: 'Executive Magistrate Bond',
  },
  {
    bnsOrBnss: 'BNSS 163 / 164',
    oldIpcOrCrpc: 'CrPC 144 / 145',
    lawCode: 'BNSS',
    title: 'Urgent Prohibitory / Land Possession Dispute Order',
    hindiMeaning: 'Jamin kabza aur dange rokne ke liye SDM order',
    bailNote: 'SDM Court Show-Cause Reply',
  },
  {
    bnsOrBnss: 'BNSS 173',
    oldIpcOrCrpc: 'CrPC 154',
    lawCode: 'BNSS',
    title: 'First Information Report (Zero FIR / e-FIR)',
    hindiMeaning: 'Kisi bhi thane me Zero FIR darj karwana',
    bailNote: 'Citizen Procedural Right',
  },
  {
    bnsOrBnss: 'BNSS 480 / 483',
    oldIpcOrCrpc: 'CrPC 437 / 439',
    lawCode: 'BNSS',
    title: 'Regular Bail Petition (Jamanat Aavedan)',
    hindiMeaning: 'Magistrate ya Sessions court me niyamit jamanat',
    bailNote: 'Regular Bail Provision',
  },
  {
    bnsOrBnss: 'BNSS 482',
    oldIpcOrCrpc: 'CrPC 438',
    lawCode: 'BNSS',
    title: 'Anticipatory Bail (Giraftari se pehle Jamanat)',
    hindiMeaning: 'Giraftari se bachne ke liye Sessions/High Court bail',
    bailNote: 'Pre-Arrest Bail',
  },
  {
    bnsOrBnss: 'NI Act 138',
    oldIpcOrCrpc: 'NI Act 138',
    lawCode: 'NI Act',
    title: 'Cheque Dishonour / Bounce Case',
    hindiMeaning: 'Cheque bounce hone par 15/30 din ka legal notice',
    bailNote: 'Bailable (Compoundable)',
  },
];
