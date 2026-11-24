import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'dist');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome116'],
  logLevel: 'info',
  sourcemap: false,
  legalComments: 'none',
};

const entries = [
  { in: 'src/background/service-worker.ts', out: 'background' },
  { in: 'src/content/content-script.ts', out: 'content' },
  { in: 'src/options/options.ts', out: 'options' },
];

const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['src/content/content.css', 'content.css'],
  ['src/options/options.html', 'options.html'],
  ['src/options/options.css', 'options.css'],
];

const manifestVersion = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    await cp(path.join(root, from), path.join(outDir, to));
  }
  // Keep the manifest version in sync with package.json.
  const manifestPath = path.join(outDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = manifestVersion;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

async function buildAll() {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyStatic();
  await build({
    ...common,
    entryPoints: entries.map((entry) => ({
      in: path.join(root, entry.in),
      out: entry.out,
    })),
    outdir: outDir,
  });
  console.log(`built ${outDir}`);
}

if (watch) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await copyStatic();
  const ctx = await context({
    ...common,
    entryPoints: entries.map((entry) => ({
      in: path.join(root, entry.in),
      out: entry.out,
    })),
    outdir: outDir,
  });
  await ctx.watch();
  console.log(`watching ${outDir}`);
} else {
  await buildAll();
}
