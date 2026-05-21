import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const size = 512;
const output = resolve('src-tauri/icons/icon.png');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function pixel(x, y) {
  const center = size / 2;
  const dx = x - center;
  const dy = y - center;
  const distance = Math.sqrt(dx * dx + dy * dy) / center;
  const star = Math.abs(dx) < 34 || Math.abs(dy) < 34 || Math.abs(dx - dy) < 22 || Math.abs(dx + dy) < 22;
  const ring = distance > 0.68 && distance < 0.83;
  if (distance > 0.94) return [0, 0, 0, 0];
  if (star && distance < 0.78) return [245, 209, 87, 255];
  if (ring) return [88, 142, 139, 255];
  return [28, 42, 47, 255];
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6;
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const rows = [];
for (let y = 0; y < size; y += 1) {
  const row = Buffer.alloc(1 + size * 4);
  row[0] = 0;
  for (let x = 0; x < size; x += 1) {
    const [r, g, b, a] = pixel(x, y);
    const offset = 1 + x * 4;
    row[offset] = r;
    row[offset + 1] = g;
    row[offset + 2] = b;
    row[offset + 3] = a;
  }
  rows.push(row);
}

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.concat(rows))),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, png);
