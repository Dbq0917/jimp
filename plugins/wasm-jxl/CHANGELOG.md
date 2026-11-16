# v1.6.0

#### 🚀 Enhancement

- Add `@jimp/wasm-jxl`, a JPEG XL (`image/jxl`) format plugin backed by the
  optional `rapier-jxl` WebAssembly codec. Supports 8-bit and 10-bit decode,
  lossless and quality-based lossy encode with configurable `effort`, alpha
  and ICC preservation, a shared codec instance for batch workloads, and
  distinct `JXL_DECODER_MISSING` / `JXL_DECODE_FAILED` error codes. Other
  formats remain fully functional when the optional dependency is absent.
