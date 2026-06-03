import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagerModule = require('@electron/packager');
const packager = packagerModule.packager || packagerModule.default || packagerModule;

const appName = 'HVY Galaxy';
const appIdentifier = 'com.heavyresume.hvy-galaxy';
const hvyDocumentTypeIdentifier = 'com.heavyresume.hvy-document';
const outDir = path.resolve('dist-electron');
const args = parseArgs(process.argv.slice(2));
const platform = args.platform || process.env.ELECTRON_PLATFORM || process.platform;
const arch = args.arch || process.env.ELECTRON_ARCH || process.arch;
const packageDir = path.join(outDir, `${appName}-${platform}-${arch}`);
const icon = platform === 'darwin'
  ? path.resolve('src-tauri', 'icons', 'icon.icns')
  : platform === 'win32'
    ? path.resolve('src-tauri', 'icons', 'icon.ico')
    : path.resolve('src-tauri', 'icons', 'icon.png');

fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

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
    CFBundleDocumentTypes: [
      {
        CFBundleTypeExtensions: ['hvy', 'thvy', 'phvy'],
        CFBundleTypeName: 'HVY Document',
        CFBundleTypeRole: 'Editor',
        LSHandlerRank: 'Owner',
        LSItemContentTypes: [hvyDocumentTypeIdentifier],
      },
    ],
    UTExportedTypeDeclarations: [
      {
        UTTypeConformsTo: ['public.data'],
        UTTypeDescription: 'HVY document',
        UTTypeIdentifier: hvyDocumentTypeIdentifier,
        UTTypeTagSpecification: {
          'public.filename-extension': ['hvy', 'thvy', 'phvy'],
          'public.mime-type': 'application/x-hvy',
        },
      },
    ],
    NSCameraUsageDescription: 'HVY Galaxy uses the camera to capture photos for image components in your HVY documents.',
  },
  extraResource: [
    path.resolve('src-tauri', 'resources'),
    path.resolve('src', 'assets', 'hvy-galaxy.hvy'),
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
  copyRustHelper(appPath);
  if (platform === 'darwin') {
    brandPackagedMacApp(appPath);
  }
  console.log(appPath);
}

if (platform === 'darwin' && os.platform() === 'darwin') {
  for (const appPath of appPaths) {
    console.log(`macOS app: ${appPath}`);
  }
}

function copyRustHelper(appPath) {
  const source = rustHelperSourcePath();
  const helperName = platform === 'win32' ? 'hvy-galaxy.exe' : 'hvy-galaxy';
  const resourcesPath = platform === 'darwin'
    ? path.join(appPath, `${appName}.app`, 'Contents', 'Resources')
    : path.join(appPath, 'resources');
  fs.copyFileSync(source, path.join(resourcesPath, helperName));
}

function rustHelperSourcePath() {
  const helperName = platform === 'win32' ? 'hvy-galaxy.exe' : 'hvy-galaxy';
  const target = rustTargetTriple();
  const candidates = [
    target ? path.resolve('src-tauri', 'target', target, 'release', helperName) : null,
    path.resolve('src-tauri', 'target', 'release', helperName),
    path.resolve('src-tauri', 'target', 'debug', helperName),
  ].filter(Boolean);
  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    throw new Error(`Rust helper binary was not found. Build src-tauri first. Tried: ${candidates.join(', ')}`);
  }
  return source;
}

function rustTargetTriple() {
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  return null;
}

function brandPackagedMacApp(appPath) {
  const plistPath = path.join(appPath, `${appName}.app`, 'Contents', 'Info.plist');
  const resourcesPath = path.join(appPath, `${appName}.app`, 'Contents', 'Resources');
  fs.copyFileSync(path.resolve('src-tauri', 'icons', 'icon.icns'), path.join(resourcesPath, 'icon.icns'));
  let plist = fs.readFileSync(plistPath, 'utf8');
  plist = setPlistString(plist, 'CFBundleIconFile', 'icon.icns');
  fs.writeFileSync(plistPath, plist);
}

function setPlistString(plist, key, value) {
  const escapedValue = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const pattern = new RegExp(`(<key>${key}</key>\\s*<string>)([^<]*)(</string>)`);
  if (!pattern.test(plist)) {
    return plist.replace('</dict>', `\t<key>${key}</key>\n\t<string>${escapedValue}</string>\n</dict>`);
  }
  return plist.replace(pattern, `$1${escapedValue}$3`);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--platform') {
      parsed.platform = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--platform=')) {
      parsed.platform = arg.slice('--platform='.length);
    } else if (arg === '--arch') {
      parsed.arch = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--arch=')) {
      parsed.arch = arg.slice('--arch='.length);
    }
  }
  return parsed;
}
