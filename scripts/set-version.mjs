import fs from 'node:fs';

const version = process.argv[2];

if (!version) {
  throw new Error('Usage: node scripts/set-version.mjs <version>');
}

const files = {
  packageJson: new URL('../package.json', import.meta.url),
  packageLock: new URL('../package-lock.json', import.meta.url),
  tauriConfig: new URL('../src-tauri/tauri.conf.json', import.meta.url),
  cargoToml: new URL('../src-tauri/Cargo.toml', import.meta.url),
  cargoLock: new URL('../src-tauri/Cargo.lock', import.meta.url),
};

writeJson(files.packageJson, (json) => {
  json.version = version;
});

writeJson(files.packageLock, (json) => {
  json.version = version;
  json.packages[''].version = version;
});

writeText(files.tauriConfig, (text) => (
  text.replace(/("version": ")[^"]+(",)/, `$1${version}$2`)
));

writeText(files.cargoToml, (text) => (
  text.replace(/(^\[package\][\s\S]*?^version = ")[^"]+(")/m, `$1${version}$2`)
));

writeText(files.cargoLock, (text) => (
  text.replace(/(\[\[package\]\]\nname = "hvy-galaxy"\nversion = ")[^"]+(")/, `$1${version}$2`)
));

console.log(`Set HVY Galaxy version to ${version}`);

function writeJson(file, update) {
  const json = JSON.parse(fs.readFileSync(file, 'utf8'));
  update(json);
  fs.writeFileSync(file, `${JSON.stringify(json, null, 2)}\n`);
}

function writeText(file, update) {
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, update(text));
}
