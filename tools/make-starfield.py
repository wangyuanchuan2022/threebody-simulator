"""Builds the star catalogue used for the night sky.

Source: d3-celestial stars.6.json (MIT, derived from the Yale Bright Star
Catalogue / Hipparcos) -- real right ascensions, declinations, V magnitudes and
B-V colour indices. Stars fainter than --mag are dropped so the visible count
matches a real naked-eye sky (mag <= 4.0 gives ~520 stars over the whole sphere,
~260 above the horizon at any moment).

Output is a compact JSON catalogue; the page renders each entry as a small
point sprite (a light point, not a star-map texture).

    python tools/make-starfield.py [--mag 4.0] [--out assets/stars.json]
"""
import argparse
import json
import urllib.request
from pathlib import Path

CATALOG = 'https://raw.githubusercontent.com/ofrohn/d3-celestial/master/data/stars.6.json'
PROXY = 'http://127.0.0.1:7897'


def fetch(url):
    for opener in (urllib.request.build_opener(urllib.request.ProxyHandler({})),
                   urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}))):
        try:
            with opener.open(url, timeout=60) as response:
                return json.loads(response.read().decode('utf-8'))
        except Exception as error:                                  # noqa: BLE001 - report and try the next route
            print('[WARN] fetch failed (%s): %s' % (type(error).__name__, error))
    raise SystemExit('[FAIL] could not fetch the star catalogue')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--mag', type=float, default=4.0, help='faintest magnitude to keep')
    parser.add_argument('--out', default='assets/stars.json')
    args = parser.parse_args()

    data = fetch(CATALOG)
    features = data.get('features', [])
    ra_values = [abs(float(f['geometry']['coordinates'][0])) for f in features[:2000]]
    hours = bool(ra_values) and max(ra_values) <= 24.0
    print('[INFO] %d catalogue entries, RA stored in %s' % (len(features), 'hours' if hours else 'degrees'))

    stars = []
    for feature in features:
        try:
            mag = float(feature['properties'].get('mag'))
            bv = float(feature['properties'].get('bv', 0.5))
        except (TypeError, ValueError):
            continue
        if mag > args.mag:
            continue
        ra, dec = (float(v) for v in feature['geometry']['coordinates'][:2])
        if hours:
            ra *= 15.0
        stars.append([round(ra % 360.0, 3), round(dec, 3), round(mag, 2), round(max(-0.4, min(2.0, bv)), 2)])

    stars.sort(key=lambda s: s[2])                      # brightest first
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({'mag': args.mag, 'source': 'd3-celestial stars.6.json (MIT)',
                               'stars': stars}, separators=(',', ':')), encoding='utf-8')
    print('[OK] %d stars (mag <= %.1f) -> %s, %.0f KB; about %d above the horizon at once'
          % (len(stars), args.mag, out, out.stat().st_size / 1024, round(len(stars) / 2)))


if __name__ == '__main__':
    main()
