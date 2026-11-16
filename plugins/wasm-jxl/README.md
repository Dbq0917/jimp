# `@jimp/wasm-jxl`

A format plugin for Jimp that adds support for JPEG XL (`image/jxl`) images
through the [rapier-jxl](https://www.npmjs.com/package/rapier-jxl) WebAssembly
codec (a libjxl-compatible encoder/decoder).

> NOTE: Only works in ESM environments.
>
> The optional `rapier-jxl` runtime requires Node.js `^20.16` or `>=22.3`
> (WebAssembly SIMD). The plugin itself imports lazily, so installing it on
> older runtimes never breaks other Jimp formats; only JXL operations require
> the supported runtime.

## Features

- Decode and encode JPEG XL, including both 8-bit and 10-bit sources.
- Lossless (`lossless: true`) and quality-based lossy encoding, with an
  `effort` knob from 1 (fast batch processing) to 9 (smallest archival files).
- Alpha channel and embedded ICC profiles are preserved.
- The WASM environment initializes once and is reused across every image, so
  batch jobs do not pay the startup cost per file.
- The codec is an optional peer dependency. When it is not installed, every
  other Jimp format keeps working; only `image/jxl` operations fail.

## Installation

```sh
npm install @jimp/wasm-jxl rapier-jxl
```

`rapier-jxl` is marked as an optional peer dependency. Omitting it leaves the
rest of Jimp fully functional.

## Usage

```ts
import { createJimp } from "@jimp/core";
import { defaultPlugins } from "jimp";
import jxl from "@jimp/wasm-jxl";

const Jimp = createJimp({
  formats: [jxl],
  plugins: defaultPlugins,
});

const image = await Jimp.read("photo.jxl");

// Lossless, maximum compression for archival ingestion.
await image.getBuffer("image/jxl", { lossless: true, effort: 9 });

// Fast, lower effort for high-volume batch processing.
await image.getBuffer("image/jxl", { quality: 80, effort: 1 });
```

Warm up the codec once during process startup so the first image does not pay
the WASM compilation cost:

```ts
import { initJxl } from "@jimp/wasm-jxl";

await initJxl();
```

## Encode options

| Option     | Type        | Default | Description                                              |
| ---------- | ----------- | ------- | -------------------------------------------------------- |
| `quality`  | `1..100`    | `75`    | Lossy quality. Ignored when `lossless` is `true`.        |
| `lossless` | `boolean`   | `true` for untouched JXL, otherwise `false` | Exact, reversible encoding. |
| `effort`   | `1..9`      | `7`     | Time/size trade-off at identical fidelity.               |
| `icc`      | `Uint8Array`| preserved profile | Override the embedded ICC profile.            |

## Precision model

Jimp's processing pipeline (resize, watermark, color plugins) operates on
8-bit RGBA. A 10-bit JXL therefore produces:

- an 8-bit RGBA bitmap used by every existing Jimp operation, and
- a side table of the original full-precision samples attached to the bitmap.

Re-encoding an image that was only decoded (no pixel edits) writes the original
bit depth, samples and ICC profile back losslessly. The side table also holds
the ICC profile for ordinary 8-bit files. Once the pixels are edited in place
or the bitmap is replaced by a resize, a fingerprint check invalidates the
table and encoding falls back to the current 8-bit RGBA buffer. This
guarantees resampled or watermarked pixels are never mislabelled as the
original camera samples.

## Error handling

Failures are `JxlError` instances with a stable `code`, so callers can tell a
broken file apart from a missing optional dependency:

| Code                   | Meaning                                                    |
| ---------------------- | ---------------------------------------------------------- |
| `JXL_DECODER_MISSING`  | `rapier-jxl` is not installed or could not be initialized. |
| `JXL_DECODE_FAILED`    | The bitstream is malformed, truncated or not JXL.          |
| `JXL_ENCODE_FAILED`    | The encoder rejected the input or its options.             |

```ts
import { JxlError } from "@jimp/wasm-jxl";

try {
  await Jimp.read("maybe-broken.jxl");
} catch (error) {
  if (error instanceof JxlError && error.code === "JXL_DECODER_MISSING") {
    // install the optional dependency
  }
}
```

## Plugin diagnostics

The backing implementation is exported as a self-describing record so it can
be listed without inspecting the Jimp registry:

```ts
import { jxlImplementation } from "@jimp/wasm-jxl";
// { name: "@jimp/wasm-jxl", mime: "image/jxl", codec: "rapier-jxl" }
```
