import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import {fileURLToPath} from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-python.mjs");

test("run-python selects an available Python 3.12 runtime", () => {
  const env = {...process.env};
  delete env.STORYVIDEOGEN_PYTHON;
  delete env.PYTHON;

  const result = spawnSync(process.execPath, [scriptPath, "--version"], {
    encoding: "utf8",
    env,
    shell: false
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Python 3\.12(?:\.\d+)?/);
});

test("run-python rejects a configured executable that is not Python 3.12", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--version"], {
    encoding: "utf8",
    env: {
      ...process.env,
      STORYVIDEOGEN_PYTHON: process.execPath
    },
    shell: false
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Python 3\.12 is required/);
});
