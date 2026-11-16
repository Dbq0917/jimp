// Generates tiny BMP files whose headers declare dimensions that are wildly
// inconsistent with the actual payload. A vulnerable decoder allocates
// width * height * 4 bytes up front, so a ~200 byte file can ask for
// gigabytes of memory. Run with: node scripts/generate-malicious-samples.mjs
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

/**
 * Build a minimal BI_RGB BMP. `pixelPayload` is the only image data written,
 * regardless of the declared dimensions, which is exactly what makes the
 * file malicious.
 */
function buildBmp({
  width,
  rawHeight,
  bitPP = 24,
  signature = "BM",
  headerSize = 40,
  pixelPayload = Buffer.alloc(32, 0xab),
}) {
  const fileHeader = Buffer.alloc(14);
  fileHeader.write(signature, 0, "ascii");
  const pixelOffset = 14 + headerSize;
  fileHeader.writeUInt32LE(pixelOffset + pixelPayload.length, 2);
  fileHeader.writeUInt32LE(pixelOffset, 10);

  const infoHeader = Buffer.alloc(headerSize);
  infoHeader.writeUInt32LE(headerSize, 0);
  infoHeader.writeUInt32LE(width >>> 0, 4);
  infoHeader.writeInt32LE(rawHeight, 8);
  infoHeader.writeUInt16LE(1, 12); // planes
  infoHeader.writeUInt16LE(bitPP, 14);
  infoHeader.writeUInt32LE(0, 16); // BI_RGB
  infoHeader.writeUInt32LE(0, 20); // raw size, 0 is valid for BI_RGB
  infoHeader.writeUInt32LE(2835, 24); // horizontal resolution
  infoHeader.writeUInt32LE(2835, 28); // vertical resolution

  return Buffer.concat([fileHeader, infoHeader, pixelPayload]);
}

const samples = {
  // 200 byte file claiming 50000x50000 pixels (~10 GB RGBA).
  "huge-dims-24bpp.bmp": buildBmp({ width: 50_000, rawHeight: 50_000 }),
  // Only the width is extreme; height stays small.
  "huge-width-24bpp.bmp": buildBmp({ width: 100_000, rawHeight: 100_000 }),
  // Top-down BMP with a negative (huge) height field.
  "negative-huge-height-32bpp.bmp": buildBmp({
    width: 40_000,
    rawHeight: -40_000,
    bitPP: 32,
  }),
  // Dimensions that overflow when multiplied in 32-bit math.
  "overflow-dims-24bpp.bmp": buildBmp({
    width: 0x0001_0000,
    rawHeight: 0x0001_0000,
  }),
  // A valid-looking header but the file ends halfway through it: corruption.
  "truncated-header.bmp": buildBmp({
    width: 10,
    rawHeight: 10,
  }).subarray(0, 20),
  // Wrong magic bytes, e.g. content disguised with a .bmp extension.
  "bad-signature.bmp": buildBmp({
    width: 10,
    rawHeight: 10,
    signature: "XX",
  }),
};

for (const [name, buffer] of Object.entries(samples)) {
  writeFileSync(join(outDir, name), buffer);
  console.log(`${name}: ${buffer.length} bytes`);
}
