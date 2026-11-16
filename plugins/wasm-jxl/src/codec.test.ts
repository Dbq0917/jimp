import { describe, expect, test } from "vitest";

import { defaultCodecLoader } from "./codec.js";

describe("default codec loader", () => {
  test("resolves the real rapier-jxl implementation", async () => {
    const codec = await defaultCodecLoader();
    expect(typeof codec.encoder.encode).toBe("function");
    expect(typeof codec.decoder.decode).toBe("function");
  });
});
