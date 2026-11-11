// Runs a command with extra environment variables, cross-platform: cmd.exe has
// no `VAR=value command` prefix and the repo does not depend on cross-env.
//
//   node scripts/with-env.ts DEBUG=pw:*,-pw:test:protocol nub run test:e2e

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const env: NodeJS.ProcessEnv = { ...process.env };
let index = 0;
while (index < args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[index]!)) {
  const [name, ...value] = args[index]!.split("=");
  env[name!] = value.join("=");
  index++;
}

const [command, ...rest] = args.slice(index);
if (command === undefined) {
  throw new Error("usage: node scripts/with-env.ts VAR=value... command [args...]");
}

// The shell resolves node_modules/.bin (on Windows the .cmd shim too), which
// nub adds to PATH for the calling script.
const quote = (arg: string) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '\\"')}"`);
const { status, error } = spawnSync([command, ...rest].map(quote).join(" "), {
  env,
  shell: true,
  stdio: "inherit",
});
if (error) throw error;
process.exit(status ?? 1);
