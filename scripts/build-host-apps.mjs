import { spawn } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const buildTauri = args.has('--tauri') || (!args.has('--tauri') && !args.has('--electron'));
const buildElectron = args.has('--electron') || (!args.has('--tauri') && !args.has('--electron'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const hostBuilds = {
  darwin: {
    tauri: {
      script: 'build:universal:dmg',
      output: ['src-tauri/target/universal-apple-darwin/release/bundle/dmg'],
    },
    electron: {
      script: 'build:electron:dmg',
      output: ['dist-electron'],
    },
  },
  win32: {
    tauri: {
      script: 'build:windows',
      output: ['src-tauri/target/release/bundle'],
    },
    electron: {
      script: 'build:electron:windows',
      output: ['dist-electron/HVY Galaxy-win32-x64'],
    },
  },
};

const scripts = hostBuilds[process.platform];
if (!scripts) {
  throw new Error(`Host app builds are not configured for ${process.platform}.`);
}

if (buildTauri) {
  await runBuild('Tauri', scripts.tauri);
}
if (buildElectron) {
  await runBuild('Electron', scripts.electron);
}

function runBuild(label, build) {
  return runScript(build.script).then(() => {
    printOutputLocations(label, build.output);
  });
}

function runScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', script], {
      stdio: 'inherit',
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${script} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}.`));
    });
  });
}

function printOutputLocations(label, directories) {
  console.log(`\n${label} output:`);
  for (const directory of directories) {
    console.log(`  ${directory}`);
  }
  console.log('');
}
