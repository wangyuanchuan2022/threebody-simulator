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


def measure(path, box=80):
    """Bright-disc statistics in a window centred on the frame.

    box=80 -> the wide sky window (background star field, sun disc);
    box=6  -> a small window holding only the star placed dead centre.
    """
    image = Image.open(path).convert('RGB')
    w, h = image.size
    crop = image.crop((w // 2 - box, h // 2 - box, w // 2 + box, h // 2 + box))
    data = crop.load()
    peak, bright, halo = 0.0, 0, 0
    for y in range(crop.height):
        for x in range(crop.width):
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
    # Overlay panels would pollute the pixel counts, so measure the canvas alone.
    page.evaluate("() => { document.querySelectorAll('.overview, .glass, footer, header, .topbar').forEach(e => { e.style.display = 'none'; }); }")
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
        row.update({('core_' + k): v for k, v in measure(shot, box=6).items()})
        row['distance_au'] = distance
        rows.append(row)
        print(json.dumps(row))
    browser.close()
    assert not errors, errors

far = [r for r in rows if r['distance_au'] >= 2.5]
near = [r for r in rows if r['distance_au'] <= 0.5]
# A flying star must read as a star: the small window holding it dead centre must
# never blow out, and its flux must grow monotonically as it approaches.
cores = [r['core_peak'] for r in rows[:3]]
assert cores == sorted(cores), ('flying star must brighten with approach', cores)
for row in far:
    assert row['core_peak'] <= 208, ('flying star blown out like a sun', row)
    # It may outshine the background stars (flux ~ 1/d^2) but must stay a point.
    assert row['disc_px'] <= 8, ('flying star shows a disc', row)
# The switch itself: the same star goes from a bare point to a saturated disc.
bloom = rows[3]                    # 1.5 AU
assert bloom['peak'] >= 205, ('no visible jump at the crossover', bloom)
assert bloom['disc_px'] >= 200, ('disc does not appear at the crossover', bloom)
for row in near:
    assert row['peak'] >= 250, ('close sun not saturated', row)
    assert row['disc_px'] >= 2000, ('close sun disc too small', row)
areas = [r['disc_px'] for r in rows[3:]]
assert areas == sorted(areas), ('disc must grow monotonically once the sun ignites', areas)
open(ROOT/'tests'/'star-bloom.json', 'w', encoding='utf-8').write(json.dumps({'rows': rows, 'sky_control': control}, indent=1))
print('[PASS] flying star stays star-like (centre peak ' + str(cores[0]) + '->' + str(cores[-1])
      + ', same order as the field peak ' + str(control['peak']) + '); ignites at the crossover (disc '
      + str(bloom['disc_px']) + 'px, peak ' + str(bloom['peak']) + ') and saturates when close (peak '
      + str(rows[-1]['peak']) + ', disc ' + str(rows[-1]['disc_px']) + 'px); disc area grows monotonically: ' + str(areas))
