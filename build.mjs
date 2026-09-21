// Builds the double-clickable single-file index.html: inlines Three.js r180
// (IIFE-isolated), GLTFLoader + BufferGeometryUtils for terrain models, an
// optional base64 terrain asset, and physics/shaders/app as classic scripts
// with sourceURL tags so browser coverage still maps to source files.
// Run: node build.mjs [--terrain path/to/model.glb] [--no-terrain] [--out index.html]
import fs from 'node:fs';
import path from 'node:path';

const read = p => fs.readFileSync(p, 'utf8');
const fail = msg => { console.error('[BUILD FAIL] ' + msg); process.exit(2); };
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outPath = flag('out', 'index.html');
// --no-terrain ships the clean build (procedural ridges); the public artifact must
// not redistribute third-party terrain assets.
const terrainPath = args.includes('--no-terrain') ? null : flag('terrain',
  fs.existsSync('assets/terrain-2k.glb') ? 'assets/terrain-2k.glb'
  : fs.existsSync('assets/terrain.glb') ? 'assets/terrain.glb'
  : fs.existsSync('assets/terrain.stl') ? 'assets/terrain.stl' : null);
const terrainKind = terrainPath ? (terrainPath.toLowerCase().endsWith('.stl') ? 'stl' : 'glb') : null;

const core = read('vendor/three.core.js');
const threeModule = read('vendor/three.module.js');
const gltfLoader = read('vendor/GLTFLoader.js');
const stlLoader = read('vendor/STLLoader.js');
const bufferUtils = read('vendor/BufferGeometryUtils.js');
const physics = read('src/physics.mjs');
const shaders = read('src/shaders.mjs');
const app = read('src/app.mjs');
const template = read('src/index.html');

// --- three.js: strip multiline import/re-export/export statements, whole-string ---
const cutOnce = (src, regex, label) => {
  const m = src.match(regex);
  if (!m) fail(label + ' pattern not found');
  if (src.split(m[0]).length !== 2) fail(label + ' pattern matched more than once');
  return { code: src.replace(regex, '\n'), removed: m[0] };
};
const parseNames = block => block
  .replace(/^\s*(?:import|export) \{/, '')
  .replace(/\} from '\.\/three\.core\.js';\s*$/, '').replace(/\};?\s*$/, '')
  .split(',').map(s => s.trim()).filter(Boolean);
if (parseNames('').length !== 0) fail('name parser sanity check failed');
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const assertIdentifiers = (list, label) => {
  const bad = list.filter(n => !IDENTIFIER.test(n));
  if (bad.length) fail(label + ' contains non-identifier tokens: ' + JSON.stringify(bad));
};

const coreExport = cutOnce(core, /export \{[^]*\};?\s*$/, 'core export');
const moduleImport = cutOnce(threeModule, /^import \{[^]*?\} from '\.\/three\.core\.js';\n?/m, 'module import');
const moduleReexport = cutOnce(moduleImport.code, /^export \{[^]*?\} from '\.\/three\.core\.js';\n?/m, 'module re-export');
const moduleExport = cutOnce(moduleReexport.code, /\nexport \{[^]*\};?\s*$/, 'module export');

const reexportNames = parseNames(moduleReexport.removed);
const exportNames = parseNames(moduleExport.removed);
const names = [...new Set([...reexportNames, ...exportNames])];
assertIdentifiers(names, 'module names');
if (names.length < 100) fail('THREE export name list too small: ' + names.length);
// core.js and module.js were separate ES modules: their private top-level names
// (e.g. _m1$1) can collide when concatenated into one scope. Scope each file in
// its own IIFE; core's public names are destructured into the shared outer scope.
const coreNames = parseNames(coreExport.removed);
assertIdentifiers(coreNames, 'core names');
if (coreNames.length < 100) fail('core export name list too small: ' + coreNames.length);
const coreIIFE = `(function(){\n'use strict';\n${coreExport.code.trim()}\nreturn { ${coreNames.join(', ')} };\n})();`;
const moduleIIFE = `(function(){\n'use strict';\n${moduleExport.code.trim()}\nwindow.THREE = { ${names.join(', ')} };\n})();`;
const threeBundle = `(function(){\n'use strict';\nconst { ${coreNames.join(', ')} } = ${coreIIFE};\n${moduleIIFE}\n})();`;

// --- app sources: import lines become empty lines, export keywords stripped ---
// Line structure stays 1:1 with src/ files so browser coverage offsets map
// directly onto source lines; 'use strict' is inlined onto the first line.
const unwrap = src => src.replace(/^import[^\n]*$/gm, '').replace(/^export /gm, '');
const wrap = (code, name) => unwrap(code).replace(/^[^\n]*/, first => `'use strict'; ${first}`) + `\n//# sourceURL=${name}`;
const physicsBundle = wrap(physics, 'physics.mjs');
const shadersBundle = wrap(shaders, 'shaders.mjs');
const appBundle = wrap(app, 'app.mjs');

// --- GLTFLoader + BufferGeometryUtils: strip every import (the 'three' names
// come from window.THREE, the utils import resolves to the inlined scope) and
// every export statement, then share one scope. ---
const stripThreeImport = (src, label) => {
  const m = src.match(/^import \{[^]*?\} from 'three';\n?/m);
  if (!m) fail(label + ' three-import not found');
  const names = m[0].replace(/^import \{/, '').replace(/\} from 'three';/, '').split(',').map(s => s.trim()).filter(Boolean);
  // Drop any remaining (relative) imports: their targets are inlined alongside.
  const code = src.replace(m[0], '\n').replace(/^import [^\n]*$/gm, '');
  return { code, names };
};
const stripExportBlock = (src, label) => {
  const m = src.match(/export \{[^{}]*\}\s*;?\s*$/);
  if (!m) fail(label + ' export block not found');
  return src.replace(m[0], '\n');
};
const loaderHalf = stripThreeImport(gltfLoader, 'GLTFLoader');
const stlHalf = stripThreeImport(stlLoader, 'STLLoader');
const utilsHalf = stripThreeImport(bufferUtils, 'BufferGeometryUtils');
const loaderNames = [...new Set([...loaderHalf.names, ...stlHalf.names, ...utilsHalf.names])];
assertIdentifiers(loaderNames, 'loader names');
const utilsCode = stripExportBlock(utilsHalf.code, 'BufferGeometryUtils export');
const gltfCode = stripExportBlock(loaderHalf.code, 'GLTFLoader export');
const stlCode = stripExportBlock(stlHalf.code, 'STLLoader export');
const loaderBundle = `(function(){\n'use strict';\nconst { ${loaderNames.join(', ')} } = window.THREE;\n${utilsCode.trim()}\n${gltfCode.trim()}\n${stlCode.trim()}\nwindow.THREE_LOADERS = { GLTFLoader, STLLoader };\n})();`;

// --- optional embedded star catalogue (real positions, built by tools/) ---
let starScript = '<!-- no star catalogue embedded -->';
if (fs.existsSync('assets/stars.json')) {
  const data = fs.readFileSync('assets/stars.json', 'utf8');
  starScript = `<script>window.STARFIELD_CATALOG = ${data.trim()};</script>`;
  console.log('[BUILD] star catalogue: assets/stars.json (' + (data.length / 1024).toFixed(0) + ' KB)');
}
let terrainScript = '<!-- no terrain model embedded -->';
if (terrainPath) {
  const data = fs.readFileSync(terrainPath);
  terrainScript = `<script>window.TERRAIN_MODEL_KIND = ${JSON.stringify(terrainKind)};window.TERRAIN_MODEL_B64 = ${JSON.stringify(data.toString('base64'))};</script>`;
  console.log('[BUILD] terrain model (' + terrainKind + '): ' + terrainPath + ' (' + (data.length / 1024).toFixed(0) + ' KB)');
}

// --- gates ---
for (const [label, code] of [['threeBundle', threeBundle], ['loaderBundle', loaderBundle], ['physicsBundle', physicsBundle], ['shadersBundle', shadersBundle], ['appBundle', appBundle]]) {
  if (/^import /m.test(code)) fail(label + ' still contains import statements');
  if (/^export /m.test(code)) fail(label + ' still contains export statements');
  if (code.includes('</script')) fail(label + ' contains a literal script-closing tag');
}
// Loader bundle may reference names as bare identifiers; all must exist on THREE.
const missingLoader = loaderNames.filter(n => !names.includes(n));
if (missingLoader.length) fail('loader names missing from THREE: ' + missingLoader.join(', '));
for (const marker of ['THREE_BUNDLE', 'LOADER_BUNDLE', 'TERRAIN_MODEL', 'STARFIELD', 'PHYSICS_BUNDLE', 'SHADERS_BUNDLE', 'APP_BUNDLE']) {
  if (!template.includes('<!--' + marker + '-->')) fail('template missing marker ' + marker);
}
// Every THREE.* symbol the app uses must be exposed by the bundle.
const used = new Set([...app.matchAll(/\bTHREE\.([A-Z][A-Za-z0-9]*)/g)].map(m => m[1]));
const missing = [...used].filter(n => !names.includes(n));
if (missing.length) fail('THREE names missing from bundle: ' + missing.join(', '));

// Function replacements insert text literally: `$&`/`` $` ``/`$'` sequences in
// two megabytes of Three.js source would otherwise corrupt String.replace.
const out = template
  .replace('<!--THREE_BUNDLE-->', () => `<script>\n${threeBundle}\n</script>`)
  .replace('<!--LOADER_BUNDLE-->', () => `<script>\n${loaderBundle}\n</script>`)
  .replace('<!--TERRAIN_MODEL-->', () => terrainScript)
  .replace('<!--STARFIELD-->', () => starScript)
  .replace('<!--PHYSICS_BUNDLE-->', () => `<script>\n${physicsBundle}\n</script>`)
  .replace('<!--SHADERS_BUNDLE-->', () => `<script>\n${shadersBundle}\n</script>`)
  .replace('<!--APP_BUNDLE-->', () => `<script>\n${appBundle}\n</script>`);

if (/<!--(THREE|LOADER|TERRAIN|STARFIELD|PHYSICS|SHADERS|APP)_(BUNDLE|MODEL)-->/.test(out)) fail('unreplaced marker in output');
if (!out.includes('window.THREE = {')) fail('THREE global assignment missing');
if (terrainPath && !out.includes('window.TERRAIN_MODEL_B64')) fail('terrain model script missing from output');
if (out.length < 1_000_000) fail('output suspiciously small: ' + out.length + ' bytes');

fs.writeFileSync(outPath, out);
console.log('[BUILD OK] ' + outPath + ' ' + (out.length / 1024 / 1024).toFixed(2) + ' MB, THREE exports ' + names.length + ', loader names ' + loaderNames.length + ', app THREE.* usages ' + used.size + ' all present' + (terrainPath ? ', terrain ' + terrainKind : ''));
