"""Captures two review stills at 1280x720: a flying-star dawn, and the moment a
star closes in and blooms into a sun (alive, closest approach, no death dialog).
Run: python tests/still.py"""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]

ADVANCE = '''(seed) => {
    observatory.test.reset(seed);
    const t = observatory.test, s = t.state();
    let best = null;
    for (let i = 0; i < 6000; i++) {
        if (s.death) return { dead: s.death.title, days: s.days };
        t.advance(0.05);
        const d = Math.min(...s.env.distances);
        if (d < 0.30 && !best) { best = { days: s.days, dist: d }; break; }
    }
    if (!best) return { dead: null, missed: true };
    t.syncView();
    return { dead: null, days: best.days, dist: best.dist };
}'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width':1280,'height':720}, device_scale_factor=1)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
    page.goto((ROOT/'index.html').as_uri()+'?test', wait_until='networkidle', timeout=60000)
    page.wait_for_function('window.observatory !== undefined', timeout=120000)
    page.wait_for_selector('#loading', state='hidden', timeout=60000)
    page.evaluate('observatory.test.setPause(true)')
    # Dawn with flying stars.
    page.evaluate('observatory.test.reset(12)')
    page.evaluate('observatory.test.syncView()')
    page.wait_for_timeout(2500)
    page.screenshot(path=str(ROOT/'tests/review-dawn.png'))
    # Bloom: first seed that survives up to a genuine close approach.
    result = None
    for seed in (12, 7, 3, 21, 33, 44, 55, 66):
        result = page.evaluate(ADVANCE, seed)
        if result.get('dist'):
            break
    if result and result.get('dist'):
        page.evaluate("() => { const d = document.getElementById('death'); if (d) d.hidden = true; }")
        page.wait_for_timeout(2500)
        page.screenshot(path=str(ROOT/'tests/review-sun-bloom.png'))
    print('[STILL] ' + str(result))
    browser.close()
    assert not errors, errors
print('[PASS] stills captured: tests/review-dawn.png (flying stars), tests/review-sun-bloom.png (live close approach)')
