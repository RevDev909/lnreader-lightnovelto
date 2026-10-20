// Build the LNReader plugin bundle into .dist/ and refresh plugins.min.json.
//
// Reads id/name/site/repo from package.json's "lnreader" field.
//
// Pipeline (DO NOT CHANGE — this is what makes the plugin install on
// OLD app versions like LNReader 2.0.0): tsc compiles TypeScript to
// ES5 CommonJS first, then esbuild bundles it. Plugin code is executed
// RAW by the app's JS engine (Hermes) via
//   Function('require','module',
//     "const exports = module.exports = {};" + rawCode +
//     "; return exports.default")(_require, {})
// with no babel transform and no polyfills, so the final bundle must
// be ES5 + Promise/Map/Set only. Native async functions, classes,
// class fields, const/let, arrows, ?. and ?? all break older app
// versions at parse time -> "Installation failed".
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const version = pkg.version;
const cfg = pkg.lnreader; // { id, name, site, repo }

mkdirSync('.dist', { recursive: true });
rmSync('.tsc-build', { recursive: true, force: true });

// 1. Type-check first so type errors fail the build loudly.
execSync(
  'npx tsc --noEmit --strict --skipLibCheck --target es2020 --lib es2020,dom src/plugin.ts src/parsers.ts',
  { stdio: 'inherit' },
);

// 2. Compile to ES5 CommonJS. --downlevelIteration for for-of over
// Map/Set; async/await becomes tsc's __awaiter state machine (no
// native generators needed).
execSync(
  'npx tsc src/plugin.ts src/parsers.ts' +
    ' --target es5 --module commonjs --lib es2020,dom' +
    ' --strict --skipLibCheck --downlevelIteration' +
    ' --outDir .tsc-build --declaration false --sourceMap false',
  { stdio: 'inherit' },
);

// 3. Bundle. tsc's `exports.default = ...` assignments pass through
// untouched, which is exactly what the app's loader returns.
await build({
  entryPoints: ['.tsc-build/plugin.js'],
  bundle: true,
  format: 'cjs',
  platform: 'neutral',
  target: 'es5',
  outfile: `.dist/${cfg.id}-${version}.js`,
  logLevel: 'info',
  footer: {
    // Belt and braces, same as Raha's other plugin builds.
    js: 'try { if (typeof module !== "undefined" && module && module.exports) module.exports.default = plugin_default; } catch (e) {}',
  },
});

const index = [
  {
    iconUrl: `https://raw.githubusercontent.com/${cfg.repo}/main/icon.png`,
    id: cfg.id,
    lang: 'English',
    name: cfg.name,
    site: cfg.site,
    url: `https://raw.githubusercontent.com/${cfg.repo}/main/.dist/${cfg.id}-${version}.js`,
    version,
  },
];
writeFileSync('.dist/plugins.min.json', JSON.stringify(index));
console.log(`wrote .dist/${cfg.id}-${version}.js and .dist/plugins.min.json`);
