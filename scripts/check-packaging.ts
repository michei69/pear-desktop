// Guards the packaging config against merge-resolution breakage:
//
//   - electron-builder.yml must parse. An invalid one aborts every packaged
//     build before packing (Nub loads the YAML; plain Node cannot).
//   - the Windows package must include the native SMTC addon. electron-vite
//     leaves it external, so without it the opt-in media controls silently stop
//     working in release builds.
//   - every `nub run <script>` in .github/workflows must exist, so a merge
//     cannot leave a CI job calling a script that was dropped.
//
// Run from CI or `nub run check:packaging`.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import config from "../apps/desktop/electron-builder.yml";

const repo = join(import.meta.dirname, "..");
const workflows = join(repo, ".github/workflows");

function fail(message: string): never {
  throw new Error(`check-packaging: ${message}`);
}

const builder = config as {
  files?: string[];
  asarUnpack?: string[];
  win?: { files?: string[]; target?: { target: string }[] };
  linux?: { target?: { target: string; arch?: string[] }[] };
};
const smtc = "node_modules/@michei69/node-smtc/**";

if (!builder.files?.includes("out/**")) fail("files no longer includes out/**");
if (!builder.win?.files?.includes(smtc)) fail(`win.files must include ${smtc}`);
if (!builder.win?.target?.some((entry) => entry.target === "nsis-web")) {
  fail("win.target lost nsis-web (a comment swallowed the key once, aborting every build)");
}
if (!builder.asarUnpack?.includes(smtc)) fail(`asarUnpack must include ${smtc}`);
if (builder.linux?.target?.some((entry) => entry.target.includes("armv7l") || entry.arch?.includes("armv7l"))) {
  fail("linux still targets armv7l, which Electron dropped after 43");
}

const scripts = Object.keys(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts as Record<string, string>);
for (const file of readdirSync(workflows).filter((name) => name.endsWith(".yml"))) {
  const text = readFileSync(join(workflows, file), "utf8");
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("#")) continue;
    for (const [, script] of line.matchAll(/\bnub run ([\w:-]+)/g)) {
      if (!scripts.includes(script!)) {
        fail(`${file} calls \`nub run ${script}\`, which package.json does not define`);
      }
    }
  }
}

console.log("check-packaging: electron-builder.yml parses and every workflow script exists");
