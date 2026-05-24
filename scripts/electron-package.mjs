import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagerModule = require('@electron/packager');
const packager = packagerModule.packager || packagerModule.default || packagerModule;

const appName = 'HVY Galaxy';
const appIdentifier = 'com.heavyresume.hvy-galaxy';
const outDir = path.resolve('dist-electron');
const platform = process.env.ELECTRON_PLATFORM || process.platform;
const arch = process.env.ELECTRON_ARCH || process.arch;
const icon = platform === 'darwin'
  ? path.resolve('src-tauri', 'icons', 'icon')
  : platform === 'win32'
    ? path.resolve('src-tauri', 'icons', 'icon')
    : path.resolve('src-tauri', 'icons', 'icon');

fs.rmSync(outDir, { recursive: true, force: true });

const appPaths = await packager({
  dir: process.cwd(),
  name: appName,
  platform,
  arch,
  out: outDir,
  overwrite: true,
  asar: true,
  icon,
  appBundleId: appIdentifier,
  appCategoryType: 'public.app-category.productivity',
  appCopyright: `Copyright ${new Date().getFullYear()} HVY`,
  darwinDarkModeSupport: true,
  extendInfo: {
    CFBundleDisplayName: appName,
    CFBundleName: appName,
    NSCameraUsageDescription: 'HVY Galaxy uses the camera to capture photos for image components in your HVY documents.',
  },
  extraResource: [
    path.resolve('src-tauri', 'resources'),
    path.resolve('src-tauri', 'icons'),
  ],
  quiet: true,
  ignore: [
    /^\/\.codex($|\/)/,
    /^\/\.electron-dev($|\/)/,
    /^\/\.git($|\/)/,
    /^\/node_modules($|\/)/,
    /^\/src-tauri\/target($|\/)/,
    /^\/dist-electron($|\/)/,
  ],
  prune: true,
});

for (const appPath of appPaths) {
  console.log(appPath);
}

if (platform === 'darwin' && os.platform() === 'darwin') {
  for (const appPath of appPaths) {
    console.log(`macOS app: ${appPath}`);
  }
}
