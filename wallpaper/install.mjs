// Installs this folder as a local wallpaper in Wallpaper Engine's library, so it
// appears under the app's "已安装 / Installed" tab next to the Workshop ones.
//
//   node wallpaper/install.mjs                  # auto-detect the Wallpaper Engine folder
//   node wallpaper/install.mjs --we "D:\path\to\wallpaper_engine"
//
// Updates package files; existing seeds.txt is preserved. Remove the folder it prints to uninstall.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fail = message => { console.error('[INSTALL FAIL] ' + message); process.exit(2); };
const argOf = name => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };

function findEngine() {
  const explicit = argOf('we');
  if (explicit) return explicit;
  const candidates = [];
  // The Steam library folders this machine actually uses, plus the usual defaults.
  for (const drive of ['C:', 'D:', 'E:']) {
    candidates.push(`${drive}\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine`);
    candidates.push(`${drive}\\Steam\\steamapps\\common\\wallpaper_engine`);
    candidates.push(`${drive}\\SteamLibrary\\steamapps\\common\\wallpaper_engine`);
    candidates.push(`${drive}\\downloads\\Steam\\steamapps\\common\\wallpaper_engine`);
  }
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'wallpaper64.exe'))) return c;
  }
  return null;
}

const engine = findEngine();
if (!engine) {
  console.error('[INSTALL FAIL] Wallpaper Engine not found. Pass --we "<path to wallpaper_engine>".');
  process.exit(2);
}

const dest = path.join(engine, 'projects', 'myprojects', 'threebody-observatory');
if (!fs.existsSync(path.join(engine, 'wallpaper64.exe')) && !fs.existsSync(path.join(engine, 'wallpaper32.exe'))) fail('Invalid Wallpaper Engine directory: ' + engine);
const files = ['index.html', 'style.css', 'project.json', 'protect.json', 'preview.jpg', 'README.md', 'seed-server.mjs'];
for (const name of files) if (!fs.existsSync(path.join(here, name))) fail('missing ' + name + ' — run build-wallpaper.mjs first');
fs.mkdirSync(dest, { recursive: true });
for (const name of files) {
  const from = path.join(here, name);
  fs.copyFileSync(from, path.join(dest, name));
}

console.log('[INSTALL OK] ' + dest);
console.log('Open Wallpaper Engine and pick「三体 · 地表观测站」from the installed wallpapers.');
console.log('Or apply it straight from a terminal (Wallpaper Engine must be running):');
console.log('  "' + path.join(engine, 'wallpaper64.exe') + '" -control openWallpaper -file "' + path.join(dest, 'project.json') + '"');
