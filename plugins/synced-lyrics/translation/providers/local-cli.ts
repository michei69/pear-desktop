import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { buildSystemPrompt, buildUserPrompt, parseLinesFromJson } from "../prompt.ts";
import type { LocalCliProviderEngine } from "../../types.ts";
import type { ProviderEnv, TranslationProvider, TranslationProviderSettings } from "../types.ts";

const ansiPattern =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:[\dA-PR-TZcf-nq-uy=><~]*(?:;[\dA-PR-TZcf-nq-uy=><~]*)*)?[\dA-PR-TZcf-nq-uy=><~]/g;

/** The CLIs are often installed by a version manager, whose paths a GUI app's PATH lacks. */
function augmentPath() {
  const fnmVersionsDir = join(homedir(), ".local", "share", "fnm", "node-versions");
  const fnmNodeBins = existsSync(fnmVersionsDir)
    ? readdirSync(fnmVersionsDir).map((version) => join(fnmVersionsDir, version, "installation", "bin"))
    : [];
  const extras = [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${homedir()}/.local/bin`,
    `${homedir()}/.npm-global/bin`,
    `${homedir()}/.volta/bin`,
    `${homedir()}/.bun/bin`,
    ...fnmNodeBins,
  ];
  return [process.env.PATH, ...extras].filter(Boolean).join(delimiter);
}

function resolveExecutable(command: string, envPath: string) {
  if (command.includes("/") || command.includes("\\")) return command;
  const names = process.platform === "win32" ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`] : [command];
  for (const entry of envPath.split(delimiter)) {
    for (const name of names) {
      const candidate = join(entry, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return command;
}

const stripAnsi = (text: string) => text.replace(ansiPattern, "").trim();

const normalizeEngine = (engine?: string): LocalCliProviderEngine => (engine === "codex" || engine === "gemini" ? engine : "claude");

function cliInvocation(engine: LocalCliProviderEngine, model: string, systemPrompt: string, userPrompt: string, cwd: string) {
  if (engine === "codex") {
    const args = ["exec", "--skip-git-repo-check", "--sandbox", "read-only", "--ephemeral", "--color", "never", "-C", cwd];
    if (model) args.push("-m", model);
    args.push("-");
    return { args, input: `${systemPrompt}\n\n${userPrompt}` };
  }

  if (engine === "gemini") {
    const args = ["--prompt", `${systemPrompt}\n\n${userPrompt}`, "--output-format", "text", "--approval-mode", "plan"];
    if (model) args.push("--model", model);
    return { args, input: "" };
  }

  const args = [
    "-p",
    "--output-format",
    "text",
    "--input-format",
    "text",
    "--system-prompt",
    systemPrompt,
    "--tools",
    "",
    "--permission-mode",
    "dontAsk",
    "--no-session-persistence",
  ];
  if (model) args.push("--model", model);
  return { args, input: userPrompt };
}

function runCli(command: string, args: string[], input: string, timeoutSeconds: number, cwd: string) {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const envPath = augmentPath();
  const executable = resolveExecutable(command, envPath);
  const child = spawn(executable, args, {
    cwd,
    env: { ...process.env, PATH: envPath, NO_COLOR: "1", FORCE_COLOR: "0" },
    shell: false,
    windowsHide: true,
  });

  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let settled = false;

  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 2000);
    reject(new Error(`Local CLI timed out after ${timeoutSeconds}s`));
  }, timeoutSeconds * 1000);

  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.on("error", (error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    reject(new Error(`Failed to start Local CLI command "${command}" (resolved as "${executable}"): ${error.message}`));
  });
  child.on("close", (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    const out = stripAnsi(Buffer.concat(stdout).toString("utf-8"));
    const error = stripAnsi(Buffer.concat(stderr).toString("utf-8"));
    if (code !== 0) return reject(new Error(`Local CLI exited with code ${code}: ${error.slice(0, 500)}`));
    resolve(out);
  });

  child.stdin.end(input);
  return promise;
}

export const localCliProvider: TranslationProvider = {
  name: "local-cli",
  async translate(req, settings, env: ProviderEnv) {
    const { engine, command, model, timeoutSeconds = 120 } = settings as TranslationProviderSettings["local-cli"];

    const normalizedEngine = normalizeEngine(engine);
    const executable = command?.trim() || normalizedEngine;
    const invocation = cliInvocation(normalizedEngine, model?.trim() || "", buildSystemPrompt(req), buildUserPrompt(req), env.userData);

    console.info("[pear:synced-lyrics] Local CLI translation request", {
      engine: normalizedEngine,
      command: executable,
      lines: req.lines.length,
    });

    const text = await runCli(executable, invocation.args, invocation.input, Math.min(Math.max(timeoutSeconds, 15), 600), env.userData);
    const parsed = parseLinesFromJson(text);
    if (!parsed) throw new Error("Could not parse JSON from the Local CLI response");
    return parsed;
  },
};
