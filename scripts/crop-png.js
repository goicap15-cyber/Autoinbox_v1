// Cắt ảnh PNG theo phần trăm (top/bottom) — không cần thư viện ngoài (zlib có sẵn).
// Dùng: node scripts/crop-png.js <in.png> <out.png> <topPct> <bottomPct>
const fs = require('fs');
const zlib = require('zlib');

const [inPath, outPath, topPctStr, bottomPctStr] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('Dùng: node scripts/crop-png.js <in.png> <out.png> <topPct> <bottomPct>');
  process.exit(1);
}
const topPct = parseFloat(topPctStr || '0');
const bottomPct = parseFloat(bottomPctStr || '0');

const buf = fs.readFileSync(inPath);
if (buf.toString('ascii', 1, 4) !== 'PNG') {
  console.error('Không phải file PNG:', inPath);
  process.exit(1);
}

let width, height, bitDepth, colorType, interlace;
const idat = [];
let pos = 8;
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos);
  const type = buf.toString('ascii', pos + 4, pos + 8);
  const data = buf.subarray(pos + 8, pos + 8 + len);
  if (type === 'IHDR') {
    width = data.readUInt32BE(0);
    height = data.readUInt32BE(4);
    bitDepth = data[8];
    colorType = data[9];
    interlace = data[12];
  } else if (type === 'IDAT') {
    idat.push(data);
  } else if (type === 'IEND') {
    break;
  }
  pos += 12 + len;
}

if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
  console.error(`Chưa hỗ trợ PNG này (bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace})`);
  process.exit(1);
}
const bpp = colorType === 6 ? 4 : 3;
const stride = width * bpp;

// Bỏ filter từng dòng
const raw = zlib.inflateSync(Buffer.concat(idat));
const pixels = Buffer.alloc(stride * height);
for (let y = 0; y < height; y++) {
  const f = raw[y * (stride + 1)];
  const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
  const outRow = y * stride;
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? pixels[outRow + x - bpp] : 0;
    const b = y > 0 ? pixels[outRow - stride + x] : 0;
    const c = y > 0 && x >= bpp ? pixels[outRow - stride + x - bpp] : 0;
    let v = row[x];
    if (f === 1) v += a;
    else if (f === 2) v += b;
    else if (f === 3) v += Math.floor((a + b) / 2);
    else if (f === 4) {
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    }
    pixels[outRow + x] = v & 0xff;
  }
}

const y0 = Math.round((height * topPct) / 100);
const y1 = height - Math.round((height * bottomPct) / 100);
const newH = y1 - y0;
if (newH <= 0) {
  console.error('Vùng cắt không hợp lệ');
  process.exit(1);
}
const cropped = Buffer.alloc(stride * newH);
for (let y = y0; y < y1; y++) {
  pixels.copy(cropped, (y - y0) * stride, y * stride, (y + 1) * stride);
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(data, zlib.crc32(t)) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(newH, 4);
ihdr[8] = bitDepth;
ihdr[9] = colorType;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

// Mỗi dòng filter byte 0 (None)
const scanlines = Buffer.alloc((stride + 1) * newH);
for (let y = 0; y < newH; y++) {
  scanlines[y * (stride + 1)] = 0;
  cropped.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const out = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, out);
console.log(`Đã crop ${inPath} -> ${outPath} (${width}x${newH}, cắt trên ${topPct}% dưới ${bottomPct}%)`);
