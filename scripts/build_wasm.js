const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const wasmDir = path.join(repoRoot, 'shared', 'network-core-wasm');
const vendorDir = path.join(repoRoot, 'build', '_vendor', 'wasm');
const tempRoot = path.join(process.env.TEMP || os.tmpdir(), 'game-terrarium-wasm');
const cargoHome = process.env.CARGO_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.cargo');
const cargoTarget = path.join(tempRoot, 'cargo-target');
const tempDir = path.join(tempRoot, 'temp');

function exists(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function candidateExecutables(names) {
  const candidates = [];

  if (process.env.CARGO) {
    candidates.push(process.env.CARGO);
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) {
    candidates.push(path.join(home, '.cargo', 'bin', names[0]));
  }

  candidates.push(path.join('C:\\tmp', 'cargo-root', 'bin', names[0]));

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const name of names) {
      candidates.push(path.join(entry, name));
    }
  }

  return candidates;
}

function resolveCargo() {
  const names = process.platform === 'win32' ? ['cargo.exe', 'cargo'] : ['cargo'];
  for (const candidate of candidateExecutables(names)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['cargo'], {
    encoding: 'utf8',
  });
  if (lookup.status === 0) {
    const found = lookup.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean);
    if (found && exists(found)) {
      return found;
    }
  }

  return null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function run() {
  const cargo = resolveCargo();
  if (!cargo) {
    throw new Error(
      'cargo が見つかりません。Rust toolchain を導入して、cargo を PATH に追加してください。',
    );
  }

  ensureDir(cargoHome);
  ensureDir(cargoTarget);
  ensureDir(tempDir);

  const env = {
    ...process.env,
    PATH: [
      path.dirname(cargo),
      path.join(process.env.USERPROFILE || process.env.HOME || '', '.cargo', 'bin'),
      path.join('C:\\tmp', 'cargo-root', 'bin'),
      process.env.PATH || '',
    ]
      .filter(Boolean)
      .join(path.delimiter),
    CARGO_HOME: cargoHome,
    CARGO_TARGET_DIR: cargoTarget,
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
  };

  const build = spawnSync(cargo, ['build', '--target', 'wasm32-unknown-unknown', '--release'], {
    cwd: wasmDir,
    env,
    stdio: 'inherit',
  });

  if (build.status !== 0) {
    process.exit(build.status || 1);
  }

  ensureDir(vendorDir);
  fs.copyFileSync(path.join(wasmDir, 'pkg', 'network_core_wasm.js'), path.join(vendorDir, 'network_core_wasm.js'));
  fs.copyFileSync(
    path.join(cargoTarget, 'wasm32-unknown-unknown', 'release', 'network_core_wasm.wasm'),
    path.join(vendorDir, 'network_core_wasm_bg.wasm'),
  );
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
