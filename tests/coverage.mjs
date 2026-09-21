import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const reports = [];
for (const name of fs.readdirSync('tests/coverage')) {
  if (name.endsWith('.json')) reports.push(JSON.parse(fs.readFileSync(path.join('tests/coverage', name), 'utf8')).result);
}
if (fs.existsSync('tests/browser-coverage.json')) reports.push(JSON.parse(fs.readFileSync('tests/browser-coverage.json', 'utf8')).result);

// Browser scripts run the BUILT bundles: their V8 byte offsets refer to the
// inline script text, whose line N maps 1:1 onto src line N (by construction in
// build.mjs). Line-level mapping is therefore exact where byte offsets are not.
const html = fs.readFileSync('index.html', 'utf8');
const bundles = {};
for (const m of html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)) {
  const tag = m[1].match(/\/\/# sourceURL=(\S+)/);
  if (tag) bundles[tag[1]] = m[1];
}
const lineOffsets = text => {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
};
const hitLines = (text, ranges) => {
  const starts = lineOffsets(text);
  const hit = new Uint8Array(starts.length);
  for (const r of ranges) {
    if (r.count <= 0) continue;
    const lo = r.startOffset, hi = Math.min(r.endOffset, text.length);
    let a = 0, b = starts.length - 1;
    while (a < b) { const mid = (a + b + 1) >> 1; if (starts[mid] <= lo) a = mid; else b = mid - 1; }
    for (let line = a; line < starts.length && starts[line] < hi; line++) hit[line] = 1;
  }
  return hit;
};

const result = [];
// shaders.mjs is a GLSL template literal: line coverage is meaningless there.
// Its verification is the browser render itself (shader compiles without console
// errors and produces frames), enforced by tests/browser.py.
for (const file of ['physics.mjs', 'app.mjs']) {
  const source = fs.readFileSync('src/' + file, 'utf8');
  const lines = source.split('\n');
  const nodeCovered = new Uint8Array(source.length); // byte-exact for node runs
  const browserHit = new Uint8Array(lines.length);   // line-exact for browser runs
  let observed = false;
  for (const report of reports) for (const script of report) {
    if (script.url.endsWith('/' + file)) {           // node: file:// URL into src/
      observed = true;
      const ranges = script.functions.flatMap(f => f.ranges);
      for (const r of ranges) if (r.count > 0) nodeCovered.fill(1, r.startOffset, Math.min(r.endOffset, source.length));
    } else if (script.url === file && bundles[file]) { // browser: bare sourceURL name
      observed = true;
      const bundleHit = hitLines(bundles[file], script.functions.flatMap(f => f.ranges));
      for (let i = 0; i < Math.min(bundleHit.length, lines.length); i++) if (bundleHit[i]) browserHit[i] = 1;
    }
  }
  const missed = [], partial = [];
  let offset = 0, total = 0, hit = 0;
  lines.forEach((line, i) => {
    const text = line.trim();
    if (text && !text.startsWith('//') && !/^[{};(),\s]+$/.test(text)) {
      total++;
      let count = 0, chars = 0;
      for (let k = 0; k < line.length; k++) if (!/\s/.test(line[k])) { chars++; count += nodeCovered[offset + k]; }
      if (count > 0 || browserHit[i]) hit++;
      else missed.push(i + 1);
      if (count > 0 && count < chars) partial.push(i + 1);
    }
    offset += line.length + 1;
  });
  result.push({ file, observed, lines: total, hit, percent: Number((hit / total * 100).toFixed(2)), missed, partial });
}
fs.writeFileSync('tests/coverage-summary.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
