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


def bright_pixels(path):
    """Count bright pixels in a UI-free window at the frame centre."""
    image = Image.open(path).convert('RGB')
    w, h = image.size
    box = image.crop((w // 2 - 300, h // 2 - 150, w // 2 + 300, h // 2 + 150))
    data = box.load()
    count, peak = 0, 0.0
    for y in range(box.height):
        for x in range(box.width):
            r, g, b = data[x, y][:3]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            peak = max(peak, lum)
            if lum > THRESHOLD:
                count += 1
    return {'bright_px': count, 'peak': round(peak, 1), 'area': box.width * box.height}


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
    # All suns straight down: unlit sky, stars at full strength.
    for index in (0, 1, 2):
        page.evaluate('observatory.test.placeStar(%d, %s, 5.0)' % (index, json.dumps(DOWN)))
    page.evaluate('observatory.test.syncView()')
    page.evaluate('observatory.test.setView(0.0, 0.75)')
    # The measurement window must be the sky canvas, not a UI panel.
    centre = page.evaluate('() => { const e = document.elementFromPoint(480, 270); return e ? (e.id || e.className || e.tagName) : "none"; }')
    assert centre in ('world', 'canvas'), ('UI overlaps the measurement window', centre)
    page.wait_for_timeout(2000)
    shot = ROOT/'tests'/'starfield.png'
    page.screenshot(path=str(shot))
    result = bright_pixels(shot)
    print(json.dumps(result))
    browser.close()
    assert not errors, errors

assert result['bright_px'] >= 40, ('night sky shows no stars', result)
assert result['peak'] >= 90, ('stars too faint to read as stars', result)
print('[PASS] night sky renders stars: %d bright pixels, peak %.1f, of %d px upper half'
      % (result['bright_px'], result['peak'], result['area']))
