import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWindowsInstaller } = require('electron-winstaller');

const appName = 'HVY Galaxy';
const installerPackageId = 'HvyGalaxy';
const appVersion = '0.1.0';
const args = parseArgs(process.argv.slice(2));
const arch = args.arch || process.env.ELECTRON_ARCH || process.arch;
const platform = args.platform || process.env.ELECTRON_PLATFORM || process.platform;

if (platform !== 'win32') {
  throw new Error('Electron Windows installer builds are only supported on Windows.');
}

const packageDir = path.resolve('dist-electron', `${appName}-win32-${arch}`);
const outputDir = path.resolve('dist-electron', 'installer', `win32-${arch}`);

if (!fs.existsSync(packageDir)) {
  throw new Error(`${packageDir} was not found. Run npm run build:electron:windows first.`);
}

fs.rmSync(outputDir, { recursive: true, force: true });

await createWindowsInstaller({
  appDirectory: packageDir,
  outputDirectory: outputDir,
  nuspecTemplate: path.resolve('scripts', 'electron-windows.nuspectemplate'),
  authors: 'HVY',
  owners: 'HVY',
  name: installerPackageId,
  title: appName,
  description: 'Cross-platform desktop app for viewing and editing HVY files.',
  version: appVersion,
  exe: `${appName}.exe`,
  setupExe: `${appName}_${appVersion}_electron_${arch}-setup.exe`,
  setupMsi: `${appName}_${appVersion}_electron_${arch}.msi`,
  setupIcon: path.resolve('src-tauri', 'icons', 'icon.ico'),
  noDelta: true,
  usePackageJson: false,
});

console.log(outputDir);

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
