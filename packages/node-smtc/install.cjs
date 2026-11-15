// Native WinRT addon: only Windows can build it. Package managers can ignore
// `os` for workspace packages, so skip the build elsewhere instead of failing installs.
if (process.platform !== "win32") process.exit(0);

require("node:child_process").execFileSync("node-gyp-build", { stdio: "inherit" });
