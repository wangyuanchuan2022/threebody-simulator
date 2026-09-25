// Optional local append-only seed archive. No dependencies; Node.js 18+.
import http from 'node:http';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const file = fileURLToPath(new URL('./seeds.txt', import.meta.url));
const known = new Set([...((fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').matchAll(/^seed: (\d+) /gm))].map(m => Number(m[1])));
const server = http.createServer((req, res) => {
  // The double-clickable page and WE are file-origin clients. Reject websites.
  if (req.headers.host !== '127.0.0.1:18765' || (req.headers.origin && req.headers.origin !== 'null')) {
    res.writeHead(403).end(); return;
  }
  res.setHeader('Access-Control-Allow-Origin', 'null');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
  if (req.url !== '/seeds' || req.method !== 'POST') { res.writeHead(404).end(); return; }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 1048576) req.destroy(); });
  req.on('end', () => {
    try {
      const records = JSON.parse(body);
      if (!Array.isArray(records) || !records.every(r => Number.isInteger(r.seed) && r.seed >= 0 && r.seed <= 4294967295 && Number.isFinite(r.days) && r.days >= 365 && r.days <= 3651)) {
        res.writeHead(400).end(); return;
      }
      for (const r of records) if (!known.has(r.seed)) {
        fs.appendFileSync(file, `seed: ${r.seed} days: ${r.days.toFixed(3)}\n`);
        known.add(r.seed);
      }
      res.writeHead(200).end('saved');
    } catch { res.writeHead(500).end('Unable to save seeds'); }
  });
});
server.listen(18765, '127.0.0.1', () => console.log(`Seed archive: ${file}\nEnable the local seed service in the page's history panel. Ctrl+C to stop.`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
