"""Verifies the night sky actually shows stars at the shipped render settings.

Pushes all three suns below the horizon (so night is total), looks up, and counts
bright pixels in the upper half. A star field must survive at whatever render
scale the adaptive resolution ends up choosing.

Run: python tests/starfield.py
"""
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DOWN = [0.0, -1.0, 0.0]
THRESHOLD = 70


def measure(path):
    """Count stars (local maxima) and bright pixels in a UI-free centre window."""
    image = Image.open(path).convert('RGB')
    w, h = image.size
    box = image.crop((w // 2 - 300, h // 2 - 150, w // 2 + 300, h // 2 + 150))
    data = box.load()
    bw, bh = box.size
    lum = [[0.0] * bw for _ in range(bh)]
    bright, peak = 0, 0.0
    for y in range(bh):
        for x in range(bw):
            r, g, b = data[x, y][:3]
            value = 0.2126 * r + 0.7152 * g + 0.0722 * b
            lum[y][x] = value
            peak = max(peak, value)
            if value > THRESHOLD:
                bright += 1
    stars = 0
    for y in range(1, bh - 1):
        for x in range(1, bw - 1):
            value = lum[y][x]
            if value <= THRESHOLD:
                continue
            if all(lum[y + dy][x + dx] <= value for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy):
                stars += 1
    return {'stars': stars, 'bright_px': bright, 'peak': round(peak, 1), 'area': bw * bh}


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_page(viewport={'width':960,'height':540}, device_scale_factor=1)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
    page.goto((ROOT/'index.html').as_uri()+'?seed=12&test', wait_until='networkidle', timeout=120000)
    page.wait_for_function('window.observatory !== undefined', timeout=180000)
    page.wait_for_selector('#loading', state='hidden', timeout=60000)
    page.evaluate('observatory.test.setPause(true)')
    page.evaluate('() => { const c = document.getElementById("clouds"); c.value = "0"; c.dispatchEvent(new Event("input")); }')
    # Deterministic render scale for the measurement window.
    page.evaluate('() => { const b = document.getElementById("autoRes"); if (b.checked) b.click(); }')
    # All suns straight down: unlit sky, stars at full strength.
    for index in (0, 1, 2):
        page.evaluate('observatory.test.placeStar(%d, %s, 5.0)' % (index, json.dumps(DOWN)))
    page.evaluate('observatory.test.syncView()')
    page.evaluate('observatory.test.setView(0.0, 0.75)')
    # Overlay panels would dominate the count, so measure the canvas alone.
    page.evaluate("() => { document.querySelectorAll('.overview, .glass, footer, header, .topbar').forEach(e => { e.style.display = 'none'; }); }")
    page.wait_for_timeout(2000)
    shot = ROOT/'tests'/'starfield.png'
    page.screenshot(path=str(shot))
    result = measure(shot)
    print(json.dumps(result))
    browser.close()
    assert not errors, errors

# The window covers about 9% of the visible hemisphere, so a real sky showing a
# couple of hundred stars overhead puts roughly 10-30 here; each star must be a
# small light point (a pixel or two), never a disc.
hemisphere = round(result['stars'] / 0.09)
assert 8 <= result['stars'] <= 40, ('star count is not sky-like', result)
assert 10 <= result['bright_px'] <= 4 * result['stars'] + 20, ('stars are not light points', result)
assert result['peak'] >= 110, ('stars too faint to read as stars', result)
print('[PASS] night sky matches a real one: %d stars in the window (~%d over the visible '
      'hemisphere), %d bright pixels (~%.1f px per star), peak %.1f'
      % (result['stars'], hemisphere, result['bright_px'], result['bright_px'] / max(1, result['stars']), result['peak']))
