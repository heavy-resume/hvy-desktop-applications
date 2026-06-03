import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const appName = 'HVY Galaxy';
const appIdentifier = 'com.heavyresume.hvy-galaxy';
const rendererUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:1420';
const require = createRequire(import.meta.url);
const electronEnv = {
  ...process.env,
  ELECTRON_RENDERER_URL: rendererUrl,
};
delete electronEnv.ELECTRON_RUN_AS_NODE;

let vite = null;

if (!(await canConnect(rendererUrl))) {
  vite = spawn(process.execPath, [path.resolve('node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '1420'], {
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
await buildRustHelper();

const electronLaunch = await electronLaunchCommand();
const electron = spawn(electronLaunch.command, electronLaunch.args, {
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

function buildRustHelper() {
  return new Promise((resolve, reject) => {
    const cargo = spawn('cargo', ['build'], {
      cwd: path.resolve('src-tauri'),
      stdio: 'inherit',
      env: process.env,
    });
    cargo.on('error', reject);
    cargo.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`cargo build exited with signal ${signal}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`cargo build exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

async function electronLaunchCommand() {
  if (process.platform !== 'darwin') {
    return { command: require('electron'), args: ['src-electron/main.cjs'] };
  }
  const command = await ensurePackagedMacDevApp();
  return { command, args: [] };
}

async function ensurePackagedMacDevApp() {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  const out = path.resolve('.electron-dev');
  const appExecutable = path.join(out, `${appName}-darwin-${arch}`, `${appName}.app`, 'Contents', 'MacOS', appName);
  const { packager } = await import('@electron/packager');

  await packager({
    dir: '.',
    name: appName,
    platform: 'darwin',
    arch,
    out,
    overwrite: true,
    icon: path.resolve('src-tauri', 'icons', 'icon.icns'),
    appBundleId: appIdentifier,
    appCategoryType: 'public.app-category.productivity',
    executableName: appName,
    asar: false,
    prune: false,
    ignore: [
      /^\/\.electron-dev(?:\/|$)/,
      /^\/\.git(?:\/|$)/,
      /^\/src-tauri\/target(?:\/|$)/,
    ],
    extendInfo: {
      CFBundleDisplayName: appName,
      NSCameraUsageDescription: 'HVY Galaxy uses the camera to capture photos for image components in your HVY documents.',
    },
  });

  return appExecutable;
}
