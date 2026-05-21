import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const [, , inputPath, outputPath = inputPath] = process.argv;

if (!inputPath) {
  throw new Error('Usage: node scripts/convert-png-to-rgba.mjs input.png [output.png]');
}

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

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilter(scanlines, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const output = Buffer.alloc(height * stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = scanlines[inputOffset];
    inputOffset += 1;
    const rowOffset = y * stride;
    const priorRowOffset = rowOffset - stride;

    for (let x = 0; x < stride; x += 1) {
      const raw = scanlines[inputOffset + x];
      const left = x >= bytesPerPixel ? output[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? output[priorRowOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? output[priorRowOffset + x - bytesPerPixel] : 0;
      let value;
      if (filter === 0) value = raw;
      else if (filter === 1) value = raw + left;
      else if (filter === 2) value = raw + up;
      else if (filter === 3) value = raw + Math.floor((left + up) / 2);
      else if (filter === 4) value = raw + paeth(left, up, upLeft);
      else throw new Error(`Unsupported PNG filter ${filter}.`);
      output[rowOffset + x] = value & 0xff;
    }
    inputOffset += stride;
  }

  return output;
}

const input = readFileSync(inputPath);
const signature = input.subarray(0, 8);
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (!signature.equals(pngSignature)) {
  throw new Error('Input is not a PNG file.');
}

let offset = 8;
let ihdr = null;
const idatParts = [];
const passthroughChunks = [];

while (offset < input.length) {
  const length = input.readUInt32BE(offset);
  const type = input.subarray(offset + 4, offset + 8).toString('ascii');
  const data = input.subarray(offset + 8, offset + 8 + length);
  offset += 12 + length;
  if (type === 'IHDR') ihdr = Buffer.from(data);
  else if (type === 'IDAT') idatParts.push(Buffer.from(data));
  else if (type !== 'IEND' && type !== 'PLTE' && type !== 'tRNS') passthroughChunks.push([type, Buffer.from(data)]);
}

if (!ihdr) {
  throw new Error('PNG is missing IHDR.');
}

const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);
const bitDepth = ihdr[8];
const colorType = ihdr[9];
const interlace = ihdr[12];

if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
  throw new Error('Only non-interlaced 8-bit RGB/RGBA PNG files are supported.');
}

const bytesPerPixel = colorType === 6 ? 4 : 3;
const rgb = unfilter(inflateSync(Buffer.concat(idatParts)), width, height, bytesPerPixel);
const rgbaStride = width * 4;
const rgbaRows = [];

for (let y = 0; y < height; y += 1) {
  const row = Buffer.alloc(1 + rgbaStride);
  row[0] = 0;
  for (let x = 0; x < width; x += 1) {
    const source = y * width * bytesPerPixel + x * bytesPerPixel;
    const target = 1 + x * 4;
    row[target] = rgb[source];
    row[target + 1] = rgb[source + 1];
    row[target + 2] = rgb[source + 2];
    row[target + 3] = colorType === 6 ? rgb[source + 3] : 255;
  }
  rgbaRows.push(row);
}

const nextIhdr = Buffer.from(ihdr);
nextIhdr[9] = 6;

writeFileSync(outputPath, Buffer.concat([
  pngSignature,
  chunk('IHDR', nextIhdr),
  ...passthroughChunks.map(([type, data]) => chunk(type, data)),
  chunk('IDAT', deflateSync(Buffer.concat(rgbaRows))),
  chunk('IEND', Buffer.alloc(0)),
]));
