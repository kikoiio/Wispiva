import assert from "node:assert/strict";
import test from "node:test";
import { paperProfile } from "./paper-turn.mjs";

test("the spine stays fixed while the paper turns from right to left", () => {
  for (const progress of [0, 0.2, 0.5, 0.8, 1]) {
    const frame = paperProfile(progress, 500, 24);
    assert.equal(frame[0].x, 0);
    assert.equal(frame[0].z, 0);
    assert.ok(frame.every((strip) => Number.isFinite(strip.angle) && strip.width > 0));
  }
  const first = paperProfile(0, 500, 24);
  const last = paperProfile(1, 500, 24);
  assert.ok(Math.abs(first.at(-1).x + first.at(-1).width - 500) < 1e-6);
  assert.ok(Math.abs(last.at(-1).x - last.at(-1).width + 500) < 1e-6);
  assert.ok(first.every((strip) => Math.abs(strip.angle) < 1e-9 && Math.abs(strip.z) < 1e-9));
  assert.ok(last.every((strip) => Math.abs(strip.angle - Math.PI) < 1e-9 && Math.abs(strip.z) < 1e-9));
});

test("intermediate paper bends and neighboring strips meet without stretching", () => {
  const frame = paperProfile(0.4, 500, 24);
  assert.ok(frame.at(-1).angle - frame[0].angle > 0.8, "a rigid rotating rectangle is not a paper curl");
  assert.ok(frame.at(-1).z > 200, "the outer edge lifts above the book");
  for (let index = 0; index < frame.length - 1; index += 1) {
    const strip = frame[index];
    assert.ok(Math.abs(strip.x + Math.cos(strip.angle) * strip.width - frame[index + 1].x) < 1e-7);
    assert.ok(Math.abs(strip.z + Math.sin(strip.angle) * strip.width - frame[index + 1].z) < 1e-7);
  }
  assert.ok(Math.abs(frame.reduce((sum, strip) => sum + strip.width, 0) - 500) < 1, "paper retains its length");
});

test("the texture on the back reaches the next left page in reading order", () => {
  const frame = paperProfile(0.6, 480, 24);
  assert.equal(frame[0].frontOffset, 0);
  assert.equal(frame[0].backOffset, 460);
  assert.equal(frame.at(-1).frontOffset, 460);
  assert.equal(frame.at(-1).backOffset, 0);
});
