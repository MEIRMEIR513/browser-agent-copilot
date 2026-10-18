import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicHttpUrl, modelSupportsVision, needsApproval, normalizeHttpUrl, parseModelList } from "../server/safety.js";

test("only allows public http and https browser URLs", async () => {
  assert.equal(normalizeHttpUrl("https://example.com"), "https://example.com/");
  assert.throws(() => normalizeHttpUrl("javascript:alert(1)"), /Only http/);
  assert.throws(() => normalizeHttpUrl("example.com"), /complete URL/);
  await assert.rejects(assertPublicHttpUrl("https://user:password@example.com/"), /embedded credentials/);
  await assert.rejects(assertPublicHttpUrl("http://127.0.0.1/admin"), /Private and reserved/);
  await assert.rejects(assertPublicHttpUrl("http://192.168.0.1/"), /Private and reserved/);
  await assert.rejects(assertPublicHttpUrl("http://metadata.google.internal/"), /metadata/);
});

test("requires approval for high-impact buttons and form submissions", () => {
  assert.equal(needsApproval({ label: "Delete account" }), true);
  assert.equal(needsApproval({ label: "Continue", isSubmit: true }), true);
  assert.equal(needsApproval({ label: "Open menu" }), false);
});

test("normalizes model catalog and Gemini model names", () => {
  assert.deepEqual(parseModelList({ models: [{ name: "models/gemini-flash", displayName: "Flash" }] }), [
    { id: "gemini-flash", name: "Flash", vision: false }
  ]);
});

test("detects vision-capable model families conservatively", () => {
  assert.equal(modelSupportsVision("gemini", "gemini-2.5-flash"), true);
  assert.equal(modelSupportsVision("groq", "llama-4-scout"), true);
  assert.equal(modelSupportsVision("github", "text-embedding-3-small"), false);
});
