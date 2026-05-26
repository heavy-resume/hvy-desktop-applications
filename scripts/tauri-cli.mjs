import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tauriCli = require.resolve('@tauri-apps/cli/tauri.js');
const env = { ...process.env };
const pathEntries = [path.dirname(process.execPath)];

if (process.platform === 'win32') {
  const home = env.USERPROFILE || (env.HOMEDRIVE && env.HOMEPATH ? `${env.HOMEDRIVE}${env.HOMEPATH}` : '');
  if (home) {
    pathEntries.push(path.join(home, '.cargo', 'bin'));
  }
}

env.PATH = [...pathEntries, env.PATH || ''].filter(Boolean).join(path.delimiter);

const child = spawn(process.execPath, [tauriCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
