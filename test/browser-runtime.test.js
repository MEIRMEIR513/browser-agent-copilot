import test from "node:test";
import assert from "node:assert/strict";
import { getBrowserRuntime } from "../server/browser-runtime.js";

test("selects packaged Chromium on Linux x64 without system package installation", () => {
  assert.equal(getBrowserRuntime("linux", "x64"), "bundled-linux-x64");
});

test("reports unsupported Linux architectures explicitly", () => {
  assert.equal(getBrowserRuntime("linux", "arm64"), "unsupported-linux");
});

test("uses the standard Playwright browser on Windows and macOS", () => {
  assert.equal(getBrowserRuntime("win32", "x64"), "playwright");
  assert.equal(getBrowserRuntime("darwin", "arm64"), "playwright");
});
