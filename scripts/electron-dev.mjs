import http from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:1420';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const require = createRequire(import.meta.url);
const electronBin = require('electron');
const electronEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: rendererUrl,
};
delete electronEnv.ELECTRON_RUN_AS_NODE;

let vite = null;

if (!(await canConnect(rendererUrl))) {
  vite = spawn(npmCommand, ['run', 'dev'], {
    stdio: 'inherit',
    env: process.env,
  });
}

const stopVite = () => {
  if (vite && !vite.killed) {
    vite.kill();
  }
};

process.on('exit', stopVite);
process.on('SIGINT', () => {
  stopVite();
  process.exit(130);
});
process.on('SIGTERM', () => {
  stopVite();
  process.exit(143);
});

await waitForRenderer(rendererUrl);

const electron = spawn(electronBin, ['src-electron/main.cjs'], {
  stdio: 'inherit',
  env: electronEnv,
});

electron.on('exit', (code, signal) => {
  stopVite();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

async function waitForRenderer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await canConnect(url)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function canConnect(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1_000, () => {
      request.destroy();
      resolve(false);
    });
  });
}
