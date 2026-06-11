import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..', '..');
const htmlRoots = ['apps', 'pages'].map((dir) => path.join(projectRoot, dir));

type ValidationResult = {
  htmlPath: string;
  missingIds: string[];
};

const pageSpecificIgnores: Record<string, Set<string>> = {
  'apps/network-defense/network_defense.html': new Set([
    'observer-mode',
    'observer-mode-state',
    'observer-event-name',
    'observer-event-detail',
    'observer-rank-senior',
    'observer-rank-mid',
    'observer-rank-junior',
    'observer-summary-text',
    'observer-summary-detail',
    'observer-hotspot-list',
    'observer-pulse',
    'observer-breach',
  ]),
};

function walkHtmlFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }
    if (entry.isFile() && fullPath.endsWith('.html')) files.push(fullPath);
  }
  return files;
}

function extractHtmlIds(source: string): Set<string> {
  const ids = new Set<string>();
  const pattern = /\sid=["']([^"']+)["']/g;
  for (const match of source.matchAll(pattern)) ids.add(match[1]);
  return ids;
}

function extractReferencedIds(source: string): Set<string> {
  const ids = new Set<string>();
  const getElementPattern = /getElementById\(\s*['"`]([^'"`]+)['"`]\s*\)/g;
  const querySelectorPattern = /querySelector(?:All)?(?:<[^>]+>)?\(\s*['"`]#([^'"`\s>~+:[\].,]+)['"`]\s*\)/g;
  for (const match of source.matchAll(getElementPattern)) {
    if (!match[1].includes('${')) ids.add(match[1]);
  }
  for (const match of source.matchAll(querySelectorPattern)) {
    if (!match[1].includes('${')) ids.add(match[1]);
  }
  return ids;
}

function extractModuleScriptPaths(htmlSource: string, htmlPath: string): string[] {
  const scriptPattern = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*><\/script>/g;
  const paths: string[] = [];
  for (const match of htmlSource.matchAll(scriptPattern)) {
    const src = match[1];
    if (!src.startsWith('.')) continue;
    const normalized = src.replace(/\.js$/, '.ts');
    paths.push(path.resolve(path.dirname(htmlPath), normalized));
  }
  return paths;
}

function resolveImportPath(importerPath: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const basePath = path.resolve(path.dirname(importerPath), specifier);
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.d.ts`,
    basePath.replace(/\.js$/, '.ts'),
    basePath.replace(/\.js$/, '.d.ts'),
    path.join(basePath, 'index.ts'),
  ];
  for (const candidate of candidates) {
    if (statExists(candidate)) return candidate;
  }
  return null;
}

function statExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function collectModuleReferencedIds(entryPath: string, visited = new Set<string>()): Set<string> {
  const ids = new Set<string>();
  if (!statExists(entryPath) || visited.has(entryPath)) return ids;
  visited.add(entryPath);
  const source = readFileSync(entryPath, 'utf8');
  for (const id of extractReferencedIds(source)) ids.add(id);

  const importPattern = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    const resolved = resolveImportPath(entryPath, specifier);
    if (!resolved) continue;
    for (const id of collectModuleReferencedIds(resolved, visited)) ids.add(id);
  }
  return ids;
}

function validateHtml(htmlPath: string): ValidationResult | null {
  const source = readFileSync(htmlPath, 'utf8');
  const htmlIds = extractHtmlIds(source);
  const referencedIds = extractReferencedIds(source);
  const relativeHtmlPath = path.relative(projectRoot, htmlPath).replace(/\\/g, '/');
  const ignoreIds = pageSpecificIgnores[relativeHtmlPath] ?? new Set<string>();
  for (const modulePath of extractModuleScriptPaths(source, htmlPath)) {
    for (const id of collectModuleReferencedIds(modulePath)) referencedIds.add(id);
  }
  const missingIds = [...referencedIds].filter((id) => !htmlIds.has(id) && !ignoreIds.has(id)).sort();
  if (!missingIds.length) return null;
  return {
    htmlPath: relativeHtmlPath,
    missingIds,
  };
}

const results = htmlRoots
  .flatMap((dir) => walkHtmlFiles(dir))
  .map((htmlPath) => validateHtml(htmlPath))
  .filter((result): result is ValidationResult => Boolean(result));

if (!results.length) {
  console.log('DOM id validation passed.');
  process.exit(0);
}

for (const result of results) {
  console.error(`${result.htmlPath}: missing ids -> ${result.missingIds.join(', ')}`);
}
process.exit(1);
