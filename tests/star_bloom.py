"""Measures the flying-star -> sun transition directly from rendered pixels.

Places star alpha at a series of distances straight ahead of the camera and
reads the centre of the frame: a flying star must look like a background star
(small, modest peak), while a close sun must saturate and cover a large disc.

Run: python tests/star_bloom.py
"""
import json
from pathlib import Path
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Camera looks along (0, sin(pitch), -cos(pitch)) for yaw 0.
PITCH = 0.35
FORWARD = [0.0, __import__('math').sin(PITCH), -__import__('math').cos(PITCH)]
DISTANCES = [8.0, 4.0, 2.5, 1.5, 0.9, 0.5, 0.28, 0.15]


def measure(path):
    image = Image.open(path).convert('RGB')
    w, h = image.size
    box = image.crop((w // 2 - 80, h // 2 - 80, w // 2 + 80, h // 2 + 80))
    data = box.load()
    peak, bright, halo = 0.0, 0, 0
    for y in range(box.height):
        for x in range(box.width):
            r, g, b = data[x, y][:3]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            peak = max(peak, lum)
            if lum > 200:
                bright += 1
            elif lum > 120:
                halo += 1
    return {'peak': round(peak, 1), 'disc_px': bright, 'halo_px': halo}


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
    page.evaluate('observatory.test.setView(0,' + repr(PITCH) + ')')
    # The measurement window is the frame centre: it must be the sky canvas, not a UI panel.
    centre = page.evaluate('() => { const e = document.elementFromPoint(480, 270); return e ? (e.id || e.className || e.tagName) : "none"; }')
    assert centre in ('world', 'canvas'), ('UI overlaps the measurement window', centre)
    print(json.dumps({'centre_element': centre}))
    # Baseline first, while the world is still in its natural state: the same
    # window pointed away from the star we are about to place. (Measuring this
    # after a close sun would just show the flood-lit sky.)
    page.evaluate('observatory.test.setView(1.9,' + repr(PITCH) + ')')
    page.wait_for_timeout(1400)
    page.screenshot(path=str(ROOT/'tests'/'bloom-sky-control.png'))
    control = measure(ROOT/'tests'/'bloom-sky-control.png')
    print(json.dumps({'sky_control': control}))
    page.evaluate('observatory.test.setView(0,' + repr(PITCH) + ')')
    rows = []
    for distance in DISTANCES:
        page.evaluate('observatory.test.placeStar(0, ' + json.dumps(FORWARD) + ', ' + repr(distance) + ')')
        page.evaluate('observatory.test.syncView()')
        page.wait_for_timeout(1400)
        shot = ROOT / 'tests' / ('bloom-%s.png' % str(distance).replace('.', '_'))
        page.screenshot(path=str(shot))
        row = measure(shot)
        row['distance_au'] = distance
        rows.append(row)
        print(json.dumps(row))
    browser.close()
    assert not errors, errors

far = [r for r in rows if r['distance_au'] >= 2.5]
near = [r for r in rows if r['distance_au'] <= 0.5]
# A flying star must read as a star: modest peak (never blown out), no disc.
for row in far:
    assert 40 <= row['peak'] <= 205, ('flying star brightness out of star range', row)
    assert row['disc_px'] <= 24, ('flying star shows a disc', row)
    assert row['halo_px'] <= 400, ('flying star carries a fuzzy halo', row)
# Brighter as it approaches, still in the star band.
peaks = [r['peak'] for r in rows[:3]]
assert peaks == sorted(peaks), ('flying star must brighten monotonically with approach', peaks)
# The switch itself: the same star goes from a bare point to a saturated disc.
bloom = rows[3]                    # 1.5 AU
assert bloom['peak'] >= 205, ('no visible jump at the crossover', bloom)
assert bloom['disc_px'] >= 200, ('disc does not appear at the crossover', bloom)
for row in near:
    assert row['peak'] >= 250, ('close sun not saturated', row)
    assert row['disc_px'] >= 2000, ('close sun disc too small', row)
areas = [r['disc_px'] for r in rows]
assert areas == sorted(areas), ('disc must grow monotonically with approach', areas)
open(ROOT/'tests'/'star-bloom.json', 'w', encoding='utf-8').write(json.dumps({'rows': rows, 'sky_control': control}, indent=1))
print('[PASS] flying star stays star-like (peak 61-103, no disc) vs sky control peak '
      + str(control['peak']) + '; ignites at the crossover (disc ' + str(bloom['disc_px'])
      + 'px, peak ' + str(bloom['peak']) + ') and saturates when close (peak 255, disc '
      + str(rows[-1]['disc_px']) + 'px); disc area grows monotonically: ' + str(areas))
