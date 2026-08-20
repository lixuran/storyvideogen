import assert from "node:assert/strict";
import test from "node:test";

import {validateWorkerMedia} from "./assetService.js";

test("worker audio accepts the MP3 formats emitted by Edge TTS", () => {
  assert.doesNotThrow(() => validateWorkerMedia(Buffer.from("ID3edge-tts-audio"), "audio", "audio/mpeg"));
  assert.doesNotThrow(() => validateWorkerMedia(Buffer.from([0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0]), "audio", "audio/mpeg"));
});

test("worker audio rejects content that is neither MP3 nor WAV", () => {
  assert.throws(() => validateWorkerMedia(Buffer.from("not audio"), "audio", "audio/mpeg"), /Worker audio is invalid/);
});
