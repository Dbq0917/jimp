// Generates tiny PNG files whose IHDR chunk declares dimensions that are
// wildly inconsistent with the (near-empty) compressed payload. A
// vulnerable decoder sizes every buffer from the IHDR dimensions before it
// notices the data is missing. Run with:
// node scripts/generate-malicious-samples.mjs
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "malicious-samples",
);

mkdirSync(outDir, { recursive: true });

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc =
        crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const body = Buffer.concat([typeBuffer, data]);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(data.length, 0);
  const footer = Buffer.alloc(4);
  footer.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([header, body, footer]);
}

function ihdr({
  width,
  height,
  depth = 8,
  colorType = 6,
  interlace = 0,
}) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width >>> 0, 0);
  data.writeUInt32BE(height >>> 0, 4);
  data.writeUInt8(depth, 8);
  data.writeUInt8(colorType, 9);
  data.writeUInt8(0, 10); // compression
  data.writeUInt8(0, 11); // filter
  data.writeUInt8(interlace, 12);

  return chunk("IHDR", data);
}

/** One filtered (filter byte 0) RGBA row of `width` pixels, compressed. */
function idatForOneRow(width) {
  const row = Buffer.alloc(1 + width * 4, 0);

  return chunk("IDAT", deflateSync(row));
}

const iend = chunk("IEND", Buffer.alloc(0));

const samples = {
  // 300 byte file claiming 50000x50000 RGBA pixels (~10 GB RGBA).
  "huge-dims-rgba.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 50_000, height: 50_000 }),
    idatForOneRow(4),
    iend,
  ]),
  // Grayscale (color type 0), one byte per pixel in the inflated stream.
  "huge-dims-grayscale.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 40_000, height: 40_000, colorType: 0 }),
    idatForOneRow(1),
    iend,
  ]),
  // 16-bit RGBA: the decoder also builds an 8 bytes/pixel intermediate.
  "huge-dims-16bit.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 30_000, height: 30_000, depth: 16 }),
    idatForOneRow(2),
    iend,
  ]),
  // Adam7 interlaced variant of the same attack.
  "huge-dims-interlaced.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 60_000, height: 60_000, interlace: 1 }),
    idatForOneRow(4),
    iend,
  ]),
  // Dimensions overflowing when multiplied in 32-bit math.
  "overflow-dims.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 0x0001_0000, height: 0x0001_0000 }),
    idatForOneRow(4),
    iend,
  ]),
  // Unsupported color type: must be reported as corruption, not a limit.
  "invalid-color-type.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 8, height: 8, colorType: 9 }),
    idatForOneRow(4),
    iend,
  ]),
  // Truncated before the IHDR data ends: corruption.
  "truncated-ihdr.png": Buffer.concat([
    PNG_SIGNATURE,
    ihdr({ width: 10, height: 10 }),
  ]).subarray(0, 25),
  // Wrong signature, e.g. content disguised with a .png extension.
  "bad-signature.png": Buffer.concat([
    Buffer.alloc(8, 0),
    ihdr({ width: 10, height: 10 }),
    idatForOneRow(4),
    iend,
  ]),
};

for (const [name, buffer] of Object.entries(samples)) {
  writeFileSync(join(outDir, name), buffer);
  console.log(`${name}: ${buffer.length} bytes`);
}
