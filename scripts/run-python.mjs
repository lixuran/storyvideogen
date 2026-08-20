import {spawn, spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function configuredPython() {
  const value = (process.env.STORYVIDEOGEN_PYTHON || process.env.PYTHON || "").trim();
  if (!value) {
    return null;
  }
  return value.replace(/^(["'])(.*)\1$/, "$2");
}

function pythonCommand() {
  const configured = configuredPython();
  if (configured) {
    return {command: configured, prefixArgs: []};
  }

  const virtualenvPython = process.platform === "win32"
    ? path.join(workspaceRoot, ".venv", "Scripts", "python.exe")
    : path.join(workspaceRoot, ".venv", "bin", "python");
  if (existsSync(virtualenvPython)) {
    return {command: virtualenvPython, prefixArgs: []};
  }

  if (process.platform === "win32") {
    return {command: "py", prefixArgs: ["-3.12"]};
  }
  return {command: "python3.12", prefixArgs: []};
}

function requirePython312(command, prefixArgs) {
  const result = spawnSync(command, [...prefixArgs, "--version"], {
    encoding: "utf8",
    shell: false
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `exit ${result.status}`;
    throw new Error(`Unable to start Python 3.12 using ${command}: ${detail}`);
  }

  const versionText = `${result.stdout || ""} ${result.stderr || ""}`.trim();
  const match = /Python\s+(\d+)\.(\d+)(?:\.(\d+))?/.exec(versionText);
  if (!match || Number(match[1]) !== 3 || Number(match[2]) !== 12) {
    throw new Error(`Python 3.12 is required; ${command} reported ${versionText || "an unknown version"}.`);
  }
}

const {command, prefixArgs} = pythonCommand();

try {
  requirePython312(command, prefixArgs);
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.stderr.write("Set STORYVIDEOGEN_PYTHON or PYTHON to an absolute Python 3.12 executable path.\n");
  process.exit(1);
}

const child = spawn(command, [...prefixArgs, ...process.argv.slice(2)], {
  cwd: workspaceRoot,
  env: process.env,
  shell: false,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (!child.killed) {
      child.kill(signal);
    }
  });
}

child.on("error", (error) => {
  process.stderr.write(`Failed to run Python 3.12: ${error.message}\n`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exitCode = code ?? 1;
});
