// Làm mờ (pixelate) các vùng hình chữ nhật trong ảnh PNG — thuần Node, không cần thư viện.
// Dùng: node scripts/blur-png.js <in.png> <out.png> <blockSize> "x1,y1,x2,y2" ["x1,y1,x2,y2" ...]
//   - blockSize: kích thước ô mosaic (px)
//   - mỗi vùng: tọa độ % theo width,height của ảnh
const fs = require('fs');
const zlib = require('zlib');

const args = process.argv.slice(2);
if (args.length < 4) {
  console.error('Dùng: node scripts/blur-png.js <in.png> <out.png> <blockSize> "x1,y1,x2,y2" [...]');
  process.exit(1);
}
const [inPath, outPath, blockSizeStr, ...regionStrs] = args;
const blockSize = parseInt(blockSizeStr, 10);
if (!blockSize || blockSize < 2) {
  console.error('blockSize phải >= 2');
  process.exit(1);
}
const regions = regionStrs.map(s => {
  const [x1, y1, x2, y2] = s.split(',').map(parseFloat);
  if ([x1, y1, x2, y2].some(isNaN)) {
    console.error('Vùng không hợp lệ:', s);
    process.exit(1);
  }
  return { x1, y1, x2, y2 };
});

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

const toPx = (pct, total) => Math.max(0, Math.min(total, Math.round((pct * total) / 100)));

for (const r of regions) {
  const x0 = toPx(r.x1, width), x1 = toPx(r.x2, width);
  const y0 = toPx(r.y1, height), y1 = toPx(r.y2, height);
  for (let by = y0; by < y1; by += blockSize) {
    const beY = Math.min(y1, by + blockSize);
    for (let bx = x0; bx < x1; bx += blockSize) {
      const beX = Math.min(x1, bx + blockSize);
      let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
      for (let y = by; y < beY; y++) {
        const row = y * stride;
        for (let x = bx; x < beX; x++) {
          const i = row + x * bpp;
          sr += pixels[i]; sg += pixels[i + 1]; sb += pixels[i + 2];
          if (bpp === 4) sa += pixels[i + 3];
          n++;
        }
      }
      const ar = Math.round(sr / n), ag = Math.round(sg / n), ab = Math.round(sb / n);
      const aa = bpp === 4 ? Math.round(sa / n) : 255;
      for (let y = by; y < beY; y++) {
        const row = y * stride;
        for (let x = bx; x < beX; x++) {
          const i = row + x * bpp;
          pixels[i] = ar; pixels[i + 1] = ag; pixels[i + 2] = ab;
          if (bpp === 4) pixels[i + 3] = aa;
        }
      }
    }
  }
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
ihdr.writeUInt32BE(height, 4);
ihdr[8] = bitDepth;
ihdr[9] = colorType;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const scanlines = Buffer.alloc((stride + 1) * height);
for (let y = 0; y < height; y++) {
  scanlines[y * (stride + 1)] = 0;
  pixels.copy(scanlines, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const out = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(outPath, out);
console.log(`Đã làm mờ ${inPath} -> ${outPath} (${width}x${height}, ${regions.length} vùng, block ${blockSize}px)`);
