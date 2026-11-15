// Native WinRT addon: only Windows can build it. Package managers can ignore
// `os` for workspace packages, so skip the build elsewhere instead of failing installs.
if (process.platform !== "win32") process.exit(0);

const { execFileSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { dirname, join } = require("node:path");

// Find node-gyp ourselves instead of spawning a bin by name. Package managers don't promise
// to put a workspace package's dependency bins on PATH while lifecycle scripts run: Windows
// CI got `spawnSync node-gyp-build ENOENT` with node-gyp-build installed and linked. Ask, in
// order: the variable npm and nub hand to lifecycle scripts, this package's own tree, the
// npm that ships next to Node (its bundled node-gyp), and only then PATH.
function findNodeGyp() {
  const fromEnv = process.env.npm_config_node_gyp;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  try {
    const manifest = require.resolve("node-gyp/package.json");
    const pkg = require(manifest);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin["node-gyp"];
    const script = join(dirname(manifest), bin);
    if (existsSync(script)) return script;
  } catch {
    // not installed alongside this package; fall through to the copies npm bundles
  }

  const nodeDir = dirname(process.execPath);
  const bundled = join("node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js");
  for (const candidate of [
    join(nodeDir, bundled), // Node for Windows: <node>\node_modules\npm\node_modules\node-gyp
    join(nodeDir, "..", "lib", bundled), // Unix: <prefix>/bin/node, npm in <prefix>/lib
    join(nodeDir, "lib", bundled),
  ]) {
    if (existsSync(candidate)) return candidate;
  }

  return null;
}

const nodeGyp = findNodeGyp();
if (nodeGyp) {
  execFileSync(process.execPath, [nodeGyp, "rebuild"], { stdio: "inherit" });
  process.exit(0);
}

// Last resort: whatever the package manager did put on PATH.
try {
  execFileSync("node-gyp", ["rebuild"], { stdio: "inherit", shell: true });
} catch {
  console.error(
    "Could not find node-gyp to build the Windows SMTC addon. Install it (npm i -g node-gyp) " +
      "or make sure the package manager exposes its bins to lifecycle scripts.",
  );
  process.exit(1);
}
