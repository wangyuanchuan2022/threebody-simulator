from pathlib import Path
import json
from playwright.sync_api import sync_playwright
ROOT = Path(__file__).resolve().parents[1]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, args=['--enable-unsafe-swiftshader','--proxy-bypass-list=<-loopback>'])
    # 820x760: panels do not overlap in desktop layout (software rasterization
    # still tractable); real experience targets hardware WebGL at full size.
    page = browser.new_page(viewport={'width':820,'height':760}, device_scale_factor=1)
    errors=[]
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type=='error' else None)
    # The deliverable is fully offline: assert it never touches the network.
    requests=[]
    page.on('request', lambda r: requests.append(r.url))
    cdp=page.context.new_cdp_session(page)
    cdp.send('Profiler.enable')
    cdp.send('Profiler.startPreciseCoverage', {'callCount':True,'detailed':True})
    page.goto((ROOT/'index.html').as_uri()+'?seed=12&test', wait_until='networkidle', timeout=60000)
    page.wait_for_function('window.observatory !== undefined',timeout=120000)
    # Software rasterization may churn GPU contexts at boot; allow recovery time.
    page.wait_for_selector('#loading', state='hidden', timeout=30000)
    page.evaluate('observatory.test.setPause(true)')
    page.wait_for_timeout(1200)
    page.screenshot(path=str(ROOT/'tests/desktop.png'))
    assert page.locator('#loading').is_hidden()
    assert page.locator('#map').is_visible()
    page.click('#pause')
    before=page.evaluate('observatory.snapshot().days')
    # Software rasterization frames take seconds; wait for any physics advance.
    page.wait_for_function('observatory.snapshot().days > '+repr(before), timeout=60000)
    page.click('#pause')
    before=page.evaluate('observatory.snapshot().days')
    page.wait_for_timeout(300)
    assert page.evaluate('observatory.snapshot().days')==before
    page.click('#restart')
    assert page.evaluate('observatory.snapshot().days')<.5
    current_seed=page.evaluate('observatory.snapshot().seed')
    # Ground/sky alignment: the terrain camera must look exactly where the sky
    # shader looks, or dragging turns the ground against the sky.
    import math
    yaw, pitch = 0.7, 0.2
    page.evaluate('observatory.test.setView(' + repr(yaw) + ',' + repr(pitch) + ')')
    page.wait_for_timeout(600)
    got = page.evaluate('observatory.test.viewDirection()')
    want = (-math.sin(yaw)*math.cos(pitch), math.sin(pitch), -math.cos(yaw)*math.cos(pitch))
    assert all(abs(a-b) < 1e-3 for a, b in zip(got, want)), (got, want)
    print(json.dumps({'view_alignment': [round(v,4) for v in got]}))
    page.click('#settings-button')
    assert page.locator('#settings').is_visible()
    page.select_option('#quality','high')
    page.locator('#clouds').fill('0.1')
    page.locator('#exposure').fill('1.2')
    page.click('#replay')
    assert page.evaluate('observatory.snapshot().seed')==current_seed
    page.click('#settings-button')
    page.mouse.move(650,450);page.mouse.down();page.mouse.move(730,410);page.mouse.up()
    page.mouse.wheel(0,120)
    map_box = page.locator('#map').bounding_box()
    page.mouse.move(map_box['x'] + map_box['width']/2, map_box['y'] + map_box['height']/2)
    page.mouse.wheel(0,100)
    page.locator('#map').focus();page.keyboard.press('ArrowLeft');page.keyboard.press('ArrowRight');page.keyboard.press('ArrowUp');page.keyboard.press('ArrowDown')
    page.keyboard.press('Space');page.keyboard.press('Space')
    page.click('#history-button');assert page.locator('#history').is_visible();page.click('#history-button')
    # Cloud motion: two stills 6s apart at the default speed, plus a machine check
    # that the weather (cloud) clock actually scales with the time-speed setting.
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '2'; s.dispatchEvent(new Event('input')); }")
    page.evaluate('observatory.test.setPause(false)')
    w0 = page.evaluate('observatory.test.weather()')
    page.wait_for_timeout(4000)
    w1 = page.evaluate('observatory.test.weather()')
    slow_rate = (w1 - w0) / 4.0
    page.screenshot(path=str(ROOT/'tests/clouds-a.png'))
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '4'; s.dispatchEvent(new Event('input')); }")
    w2 = page.evaluate('observatory.test.weather()')
    page.wait_for_timeout(4000)
    w3 = page.evaluate('observatory.test.weather()')
    fast_rate = (w3 - w2) / 4.0
    page.screenshot(path=str(ROOT/'tests/clouds-b.png'))
    page.evaluate('observatory.test.setPause(true)')
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '1'; s.dispatchEvent(new Event('input')); }")
    assert fast_rate > slow_rate * 1.8, (slow_rate, fast_rate)
    print(json.dumps({'weather_rate_slow':round(slow_rate,2),'weather_rate_fast':round(fast_rate,2)}))
    # Adaptive step: slow rates must integrate finely (no half-second quantum),
    # fast rates must stay capped so the work per frame stays bounded.
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '1'; s.dispatchEvent(new Event('input')); }")
    page.evaluate('observatory.test.setPause(false)')
    page.wait_for_timeout(1500)
    slow_step = page.evaluate('observatory.test.stepDays()')
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '4'; s.dispatchEvent(new Event('input')); }")
    page.wait_for_timeout(1500)
    fast_step = page.evaluate('observatory.test.stepDays()')
    page.evaluate('observatory.test.setPause(true)')
    assert slow_step <= 0.025/5, slow_step
    assert abs(fast_step - 0.025) < 1e-9, fast_step
    print(json.dumps({'step_slow':slow_step,'step_fast':fast_step}))
    # Era label must state a period (恒纪元/乱纪元), never flicker frame to frame.
    page.evaluate("() => { const s = document.getElementById('speed'); s.value = '1'; s.dispatchEvent(new Event('input')); }")
    page.evaluate('observatory.test.setPause(false)')
    labels=[]
    for _ in range(6):
        labels.append(page.evaluate('observatory.test.era()["label"]'))
        page.wait_for_timeout(400)
    page.evaluate('observatory.test.setPause(true)')
    assert all(l in ('观测中','恒纪元','乱纪元') for l in labels), labels
    changes=sum(1 for a,b in zip(labels,labels[1:]) if a!=b)
    assert changes<=1, labels
    print(json.dumps({'era_labels':labels,'era_changes':changes}))
    # The high-speed window above can end the world on its own (the death dialog
    # then blocks clicks), so reset through the test hook before the next probe.
    page.evaluate('observatory.test.reset()')
    # Inject a physical collision through the production physics path, not a fake dialog.
    page.evaluate('''() => {const s=observatory.test.state();s.bodies[3].p=[...s.bodies[0].p];observatory.test.advance(.025);}''')
    page.wait_for_selector('#death:not([hidden])')
    assert '坠入太阳' in page.locator('#death-title').inner_text()
    page.screenshot(path=str(ROOT/'tests/destruction.png'))
    page.click('#next-world');assert page.locator('#death').is_hidden()
    generation=page.evaluate('observatory.snapshot().generation')
    page.evaluate('''() => {observatory.test.setPause(false);const s=observatory.test.state();s.hotDays=8;observatory.test.advance(.025);}''')
    page.wait_for_function(f'observatory.snapshot().generation>{generation}',timeout=60000)
    page.evaluate('observatory.test.setPause(true)')
    page.set_viewport_size({'width':390,'height':844})
    page.wait_for_timeout(600)
    page.screenshot(path=str(ROOT/'tests/mobile.png'))
    # GPU context loss guard: the real DOM event the browser fires on context loss.
    # The notice is debounced 2s in the app; persistent loss still surfaces.
    page.evaluate('''() => {
        document.getElementById('world').dispatchEvent(new Event('webglcontextlost', {cancelable: true}));
    }''')
    page.wait_for_selector('#loading', state='visible', timeout=8000)
    assert '图形上下文丢失' in page.locator('#loading').inner_text()
    # Cover the restore handler, then force the debounced timer deterministically
    # (a real driver churn may have satisfied the visible wait via an earlier timer).
    page.evaluate('document.getElementById("world").dispatchEvent(new Event("webglcontextrestored"))')
    page.wait_for_selector('#loading', state='hidden', timeout=8000)
    page.evaluate('''() => {
        document.getElementById('world').dispatchEvent(new Event('webglcontextlost', {cancelable: true}));
    }''')
    page.wait_for_timeout(2600)
    assert '图形上下文丢失' in page.locator('#loading').inner_text()
    # Terrain paths: a GLB fixture and a real Terrain2STL solid must both mount a
    # real mesh (STL carries no material, so it must also get elevation colours).
    # Same browser instance: nesting sync_playwright contexts breaks the sync API.
    for variant, shot, expect_colored in (('terrain-test.html','terrain.png',False), ('stl-test.html','terrain-stl.png',True)):
        tpage = browser.new_page(viewport={'width':480,'height':320}, device_scale_factor=1)
        terrors=[]
        tpage.on('pageerror', lambda e: terrors.append(str(e)))
        tpage.on('console', lambda m: terrors.append(m.text) if m.type=='error' else None)
        tpage.goto((ROOT/variant).as_uri()+'?seed=12&test', wait_until='networkidle', timeout=60000)
        tpage.wait_for_function('window.observatory !== undefined', timeout=120000)
        tpage.evaluate('observatory.test.setPause(true)')
        tpage.wait_for_function('observatory.test.terrainReady()===true', timeout=60000)
        snap = tpage.evaluate('observatory.snapshot()')
        assert snap['seed']==12, (variant, snap)
        info = tpage.evaluate('observatory.test.terrainInfo()')
        assert info and info['triangles']>1000, (variant, info)
        assert info['colored']==expect_colored, (variant, info)
        print(json.dumps({'terrain':variant,'info':info}))
        tpage.wait_for_timeout(1500)
        tpage.screenshot(path=str(ROOT/'tests'/shot))
        tpage.close()
        assert not terrors, (variant, terrors)
    coverage=cdp.send('Profiler.takePreciseCoverage')
    (ROOT/'tests/browser-coverage.json').write_text(json.dumps(coverage),encoding='utf-8')
    print(json.dumps({'errors':errors,'snapshot':page.evaluate('observatory.snapshot()')},ensure_ascii=True))
    browser.close()
    assert not errors, errors
    offline = [u for u in requests if not u.startswith(('file:', 'data:', 'blob:'))]
    assert not offline, offline
print('[PASS] browser: double-click offline file, render, pause, speed controls, orbit map, reset, physical destruction, automatic restart, mobile layout, cloud motion stills, GLB terrain mount')
