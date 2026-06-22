const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const wasmDir = path.join(repoRoot, 'shared', 'network-core-wasm');
const vendorDir = path.join(repoRoot, 'build', '_vendor', 'wasm');
const tempRoot = path.join(
  process.env.TEMP || process.env.TMP || process.env.TMPDIR || path.join(repoRoot, '.tmp'),
  'game-terrarium-wasm',
);
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

  if (process.env.WASM_PACK) {
    candidates.push(process.env.WASM_PACK);
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (home) {
    for (const name of names) {
      candidates.push(path.join(home, '.cargo', 'bin', name));
    }
  }

  for (const name of names) {
    candidates.push(path.join('C:\\tmp', 'cargo-root', 'bin', name));
  }

  const pathEntries = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    for (const name of names) {
      candidates.push(path.join(entry, name));
    }
  }

  return candidates;
}

function resolveWasmPack() {
  const names = process.platform === 'win32' ? ['wasm-pack.exe', 'wasm-pack'] : ['wasm-pack'];
  for (const candidate of candidateExecutables(names)) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  const lookup = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['wasm-pack'], {
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
  const pkgJs = path.join(wasmDir, 'pkg', 'network_core_wasm.js');
  const pkgWasm = path.join(wasmDir, 'pkg', 'network_core_wasm_bg.wasm');
  const forceBuild = process.env.FORCE_WASM_BUILD === '1';

  if (forceBuild || !exists(pkgJs) || !exists(pkgWasm)) {
    const wasmPack = resolveWasmPack();
    if (!wasmPack) {
      throw new Error('wasm-pack が見つかりません。Rust toolchain を導入して PATH に追加してください。');
    }

    ensureDir(cargoHome);
    ensureDir(cargoTarget);
    ensureDir(tempDir);

    const env = {
      ...process.env,
      PATH: [
        path.dirname(wasmPack),
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

    const build = spawnSync(wasmPack, ['build', '--dev', '--target', 'web', '--out-dir', 'pkg'], {
      cwd: wasmDir,
      env,
      stdio: 'inherit',
    });

    if (build.status !== 0) {
      process.exit(build.status || 1);
    }
  }

  ensureDir(vendorDir);
  fs.copyFileSync(pkgJs, path.join(vendorDir, 'network_core_wasm.js'));
  fs.copyFileSync(pkgWasm, path.join(vendorDir, 'network_core_wasm_bg.wasm'));
}

try {
  run();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
