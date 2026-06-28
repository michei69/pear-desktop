import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { app } from 'electron';

import {
  buildSystemPrompt,
  buildUserPrompt,
  parseLinesFromJson,
} from '../prompt';

import type { LocalCliProviderEngine } from '../../types';
import type { TranslationProvider } from '../types';

const ansiPattern =
  // eslint-disable-next-line no-control-regex
  /[\u001b\u009b][[\]()#;?]*(?:[\dA-PR-TZcf-nq-uy=><~]*(?:;[\dA-PR-TZcf-nq-uy=><~]*)*)?[\dA-PR-TZcf-nq-uy=><~]/g;

const augmentPath = () => {
  const fnmVersionsDir = join(
    homedir(),
    '.local',
    'share',
    'fnm',
    'node-versions',
  );
  const fnmNodeBins = existsSync(fnmVersionsDir)
    ? readdirSync(fnmVersionsDir).map((version) =>
        join(fnmVersionsDir, version, 'installation', 'bin'),
      )
    : [];
  const extras = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    `${homedir()}/.local/bin`,
    `${homedir()}/.npm-global/bin`,
    `${homedir()}/.volta/bin`,
    `${homedir()}/.bun/bin`,
    ...fnmNodeBins,
  ];
  return [process.env.PATH, ...extras].filter(Boolean).join(delimiter);
};

const resolveExecutable = (command: string, envPath: string) => {
  if (command.includes('/') || command.includes('\\')) return command;

  const executableNames =
    process.platform === 'win32'
      ? [command, `${command}.cmd`, `${command}.exe`, `${command}.bat`]
      : [command];

  for (const pathEntry of envPath.split(delimiter)) {
    for (const executableName of executableNames) {
      const candidate = join(pathEntry, executableName);
      if (existsSync(candidate)) return candidate;
    }
  }

  return command;
};

const stripAnsi = (text: string) => text.replace(ansiPattern, '').trim();

const normalizeEngine = (engine?: string): LocalCliProviderEngine => {
  if (engine === 'codex' || engine === 'gemini') return engine;
  return 'claude';
};

const defaultCommandForEngine = (engine: LocalCliProviderEngine): string => {
  if (engine === 'codex') return 'codex';
  if (engine === 'gemini') return 'gemini';
  return 'claude';
};

const cliInvocation = (
  engine: LocalCliProviderEngine,
  model: string,
  systemPrompt: string,
  userPrompt: string,
): { args: string[]; input: string } => {
  if (engine === 'codex') {
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '--ephemeral',
      '--color',
      'never',
      '-C',
      app.getPath('userData'),
    ];
    if (model) args.push('-m', model);
    args.push('-');
    return {
      args,
      input: `${systemPrompt}\n\n${userPrompt}`,
    };
  }

  if (engine === 'gemini') {
    const args = [
      '--prompt',
      `${systemPrompt}\n\n${userPrompt}`,
      '--output-format',
      'text',
      '--approval-mode',
      'plan',
    ];
    if (model) args.push('--model', model);
    return { args, input: '' };
  }

  const args = [
    '-p',
    '--output-format',
    'text',
    '--input-format',
    'text',
    '--system-prompt',
    systemPrompt,
    '--tools',
    '',
    '--permission-mode',
    'dontAsk',
    '--no-session-persistence',
  ];
  if (model) args.push('--model', model);
  return { args, input: userPrompt };
};

const runCli = async (
  command: string,
  args: string[],
  input: string,
  timeoutSeconds: number,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const envPath = augmentPath();
    const executable = resolveExecutable(command, envPath);
    const child = spawn(executable, args, {
      cwd: app.getPath('userData'),
      env: {
        ...process.env,
        PATH: envPath,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      shell: false,
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
      reject(new Error(`Local CLI timed out after ${timeoutSeconds}s`));
    }, timeoutSeconds * 1000);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(
        new Error(
          `Failed to start Local CLI command "${command}" resolved as "${executable}": ${err.message}`,
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const out = stripAnsi(Buffer.concat(stdout).toString('utf-8'));
      const err = stripAnsi(Buffer.concat(stderr).toString('utf-8'));
      if (code !== 0) {
        reject(
          new Error(`Local CLI exited with code ${code}: ${err.slice(0, 500)}`),
        );
        return;
      }
      resolve(out);
    });

    child.stdin.end(input);
  });

export const localCliProvider: TranslationProvider = {
  name: 'local-cli',
  async translate(req, settings) {
    const { engine, timeoutSeconds = 120 } = settings as {
      engine?: LocalCliProviderEngine;
      timeoutSeconds?: number;
    };

    const normalizedEngine = normalizeEngine(engine);
    const resolvedCommand = defaultCommandForEngine(normalizedEngine);

    const { args, input } = cliInvocation(
      normalizedEngine,
      '',
      buildSystemPrompt(req),
      buildUserPrompt(req),
    );

    console.info('[synced-lyrics] Local CLI translation request', {
      engine: normalizedEngine,
      command: resolvedCommand,
      model: 'auto',
      lines: req.lines.length,
    });

    const text = await runCli(
      resolvedCommand,
      args,
      input,
      Math.min(Math.max(timeoutSeconds, 15), 600),
    );
    const parsed = parseLinesFromJson(text, req.lines.length);
    if (!parsed) {
      throw new Error('Could not parse JSON from Local CLI response');
    }
    return parsed;
  },
};
