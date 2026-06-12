import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { PAGE_REGISTRY, type PageDefinition, type PageLoadMode } from '../shared/page_registry';

const projectRoot = path.resolve(__dirname, '..', '..');
const htmlRoots = ['apps', 'pages'].map((dir) => path.join(projectRoot, dir));

type ValidationResult = {
  htmlPath: string;
  page: PageDefinition | null;
  missingIds: string[];
  missingRefs: string[];
};

type RuntimeContext = {
  loadMode: PageLoadMode;
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

const pageByHtmlPath = new Map<string, PageDefinition>(
  PAGE_REGISTRY.map((page) => {
    return [page.htmlPath.replace(/^\//, ''), page];
  })
);

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

function extractLocalReferences(source: string): string[] {
  const refs = new Set<string>();
  const attrPattern = /(?:src|href)=["']([^"']+)["']/g;
  for (const match of source.matchAll(attrPattern)) {
    const ref = match[1];
    if (ref.startsWith('http://') || ref.startsWith('https://') || ref.startsWith('//') || ref.startsWith('data:')) continue;
    if (ref.includes('cdn.jsdelivr.net')) continue;
    if (ref.startsWith('#')) continue;
    refs.add(ref);
  }

  const importPattern = /import\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    const ref = match[1] ?? match[2];
    if (!ref) continue;
    if (!ref.startsWith('.') && !ref.startsWith('/')) continue;
    refs.add(ref);
  }

  return [...refs];
}

function resolveLocalRef(refPath: string, ref: string, page: RuntimeContext | null): string | null {
  if (!ref.startsWith('.') && !ref.startsWith('/')) return null;
  const sourcePath = ref.startsWith('/')
    ? path.join(projectRoot, ref.slice(1))
    : path.resolve(path.dirname(refPath), ref);

  if (statExists(sourcePath)) return sourcePath;

  if (ref.startsWith('/')) {
    const localFallback = path.resolve(path.dirname(refPath), path.basename(ref));
    if (statExists(localFallback)) return localFallback;
    if (localFallback.endsWith('.js')) {
      const tsPath = localFallback.replace(/\.js$/, '.ts');
      if (statExists(tsPath)) return tsPath;
      const dtsPath = localFallback.replace(/\.js$/, '.d.ts');
      if (statExists(dtsPath)) return dtsPath;
    }
  }

  if (sourcePath.endsWith('.js')) {
    const tsPath = sourcePath.replace(/\.js$/, '.ts');
    if (statExists(tsPath)) return tsPath;
    const dtsPath = sourcePath.replace(/\.js$/, '.d.ts');
    if (statExists(dtsPath)) return dtsPath;
    const buildPath = path.join(projectRoot, 'build', path.relative(projectRoot, sourcePath));
    if (statExists(buildPath)) return buildPath;
    const sharedTelemetry = path.join(projectRoot, 'shared', path.basename(sourcePath));
    if (path.basename(sourcePath) === 'telemetry-client.js' && statExists(sharedTelemetry)) return sharedTelemetry;
  }

  return null;
}

function extractModuleScriptPaths(htmlSource: string, htmlPath: string, page: RuntimeContext | null): string[] {
  const scriptPattern = /<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["'][^>]*><\/script>/g;
  const paths: string[] = [];
  for (const match of htmlSource.matchAll(scriptPattern)) {
    const src = match[1];
    if (!src.startsWith('.')) continue;
    const resolved = resolveLocalRef(htmlPath, src, page);
    if (resolved) paths.push(resolved);
  }
  return paths;
}

function statExists(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function validateHtml(htmlPath: string): ValidationResult | null {
  const source = readFileSync(htmlPath, 'utf8');
  const relativeHtmlPath = path.relative(projectRoot, htmlPath).replace(/\\/g, '/');
  const page = pageByHtmlPath.get(relativeHtmlPath) ?? null;
  const runtimeContext: RuntimeContext = page ?? { loadMode: relativeHtmlPath.startsWith('apps/') ? 'http' : 'file' };
  const htmlIds = extractHtmlIds(source);
  const referencedIds = extractReferencedIds(source);
  const ignoreIds = pageSpecificIgnores[relativeHtmlPath] ?? new Set<string>();
  const missingRefs = new Set<string>();

  for (const ref of extractLocalReferences(source)) {
    const resolved = resolveLocalRef(htmlPath, ref, runtimeContext);
    if (!resolved) missingRefs.add(ref);
  }

  for (const modulePath of extractModuleScriptPaths(source, htmlPath, runtimeContext)) {
    const moduleSource = readFileSync(modulePath, 'utf8');
    for (const id of extractReferencedIds(moduleSource)) referencedIds.add(id);
    for (const ref of extractLocalReferences(moduleSource)) {
      const resolved = resolveLocalRef(modulePath, ref, runtimeContext);
      if (!resolved) missingRefs.add(ref);
    }
  }

  const missingIds = [...referencedIds].filter((id) => !htmlIds.has(id) && !ignoreIds.has(id)).sort();
  if (!missingIds.length && !missingRefs.size) return null;
  return {
    htmlPath: relativeHtmlPath,
    page,
    missingIds,
    missingRefs: [...missingRefs].sort(),
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
  const prefix = result.page ? `${result.page.number} (${result.page.key}) ${result.page.label}` : result.htmlPath;
  const issues = [
    result.missingIds.length ? `missing ids -> ${result.missingIds.join(', ')}` : '',
    result.missingRefs.length ? `missing refs -> ${result.missingRefs.join(', ')}` : '',
  ].filter(Boolean);
  console.error(`${prefix}: ${issues.join(' | ')}`);
}
process.exit(1);
