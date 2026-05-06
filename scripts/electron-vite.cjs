const { spawn } = require("node:child_process");
const { join } = require("node:path");

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const cliPath = join(
  __dirname,
  "..",
  "node_modules",
  "electron-vite",
  "bin",
  "electron-vite.js",
);

const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
