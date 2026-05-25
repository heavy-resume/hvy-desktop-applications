import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const appName = 'HVY Galaxy';
const arch = process.env.ELECTRON_ARCH || process.arch;
const platform = process.env.ELECTRON_PLATFORM || process.platform;

if (platform !== 'darwin') {
  throw new Error('Electron DMG builds are only supported on macOS.');
}

const packageDir = path.resolve('dist-electron', `${appName}-darwin-${arch}`);
const appPath = path.join(packageDir, `${appName}.app`);
const dmgPath = path.resolve('dist-electron', `${appName}_0.1.0_electron_${arch}.dmg`);

if (!fs.existsSync(appPath)) {
  throw new Error(`${appPath} was not found. Run npm run build:electron first.`);
}

const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hvy-electron-dmg-'));

try {
  fs.cpSync(appPath, path.join(stagingDir, `${appName}.app`), {
    recursive: true,
    verbatimSymlinks: true,
  });
  fs.symlinkSync('/Applications', path.join(stagingDir, 'Applications'));
  fs.mkdirSync(path.dirname(dmgPath), { recursive: true });
  fs.rmSync(dmgPath, { force: true });
  await run('hdiutil', [
    'create',
    '-volname',
    appName,
    '-srcfolder',
    stagingDir,
    '-ov',
    '-format',
    'UDZO',
    dmgPath,
  ]);
  console.log(dmgPath);
} finally {
  fs.rmSync(stagingDir, { recursive: true, force: true });
}
