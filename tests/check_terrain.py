from pathlib import Path
import time
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader'])
    page = b.new_page(viewport={'width':960,'height':540}, device_scale_factor=1)
    logs=[]
    page.on('pageerror', lambda e: logs.append('PAGEERR '+str(e)))
    page.on('console', lambda m: logs.append(m.type+': '+m.text[:200]) if m.type in ('error','warning') else None)
    start=time.time()
    page.goto((ROOT/'index.html').as_uri()+'?seed=12&test', wait_until='networkidle', timeout=180000)
    page.wait_for_function('window.observatory !== undefined', timeout=300000)
    print('boot seconds: %.1f' % (time.time()-start))
    page.evaluate('observatory.test.setPause(true)')
    page.wait_for_function('observatory.test.terrainReady()===true', timeout=120000)
    print('terrain seconds: %.1f' % (time.time()-start))
    print('terrainInfo:', page.evaluate('observatory.test.terrainInfo()'))
    print('scene:', page.evaluate('''() => { const out=[]; observatory.test.state(); return (window.__worldDebug && window.__worldDebug()) || 'n/a'; }'''))
    page.wait_for_timeout(3000)
    page.screenshot(path=str(ROOT/'tests/terrain-glb-check.png'))
    print('logs:', logs[:6])
    b.close()
print('[PASS] embedded GLB terrain mounts on the deliverable page')
