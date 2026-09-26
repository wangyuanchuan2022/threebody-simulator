// npm install --no-save playwright, or set NODE_PATH to an existing installation.
const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const previewBefore = fs.readFileSync(path.resolve('wallpaper/preview.jpg'));
(async () => {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true, args: ['--enable-unsafe-swiftshader'] });
  try {
    for (const file of ['index.html', 'wallpaper/index.html']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve(file)).href + '?seed=12&test');
      await page.waitForFunction(() => !!window.observatory);
      await page.waitForFunction(() => observatory.test.terrainReady());
      assert.ok(await page.evaluate(() => observatory.test.terrainInfo()?.triangles > 0));
      assert.equal(await page.locator('#auto-pan').isChecked(), file.startsWith('wallpaper/'));
      if (file.startsWith('wallpaper/')) {
        const startYaw = await page.evaluate(() => uniforms.yaw.value);
        await page.waitForFunction(y => uniforms.yaw.value > y + .001, startYaw);
      }
      await page.evaluate(() => observatory.test.setPause(true));
      const pausedYaw = await page.evaluate(() => uniforms.yaw.value);
      await page.waitForTimeout(150);
      assert.equal(await page.evaluate(() => uniforms.yaw.value), pausedYaw);
      const yaw = await page.evaluate(() => uniforms.yaw.value);
      await page.mouse.move(640, 450); await page.mouse.down();
      await page.mouse.move(710, 480); await page.mouse.up();
      assert.notEqual(await page.evaluate(() => uniforms.yaw.value), yaw);
      if (file.startsWith('wallpaper/')) {
        await page.evaluate(() => observatory.test.setPause(false));
        const manualYaw = await page.evaluate(() => uniforms.yaw.value);
        await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => uniforms.yaw.value), manualYaw);
        await page.evaluate(() => observatory.test.setPause(true));
      }
      const fov = await page.evaluate(() => uniforms.fov.value);
      await page.mouse.wheel(0, 200);
      await page.waitForFunction(f => uniforms.fov.value !== f, fov);
      await page.locator('.orbital .panel-title').click();
      assert.equal(await page.locator('#map').isVisible(), false);
      await page.locator('.orbital .panel-title').click();
      const zoom = await page.evaluate(() => mapZoom);
      await page.locator('#map').hover(); await page.mouse.wheel(0, 200);
      await page.waitForFunction(z => mapZoom !== z, zoom);
      await page.locator('#world').focus();
      for (const key of ['ArrowUp','ArrowDown','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','a','b']) await page.keyboard.press(key);
      assert.equal(await page.locator('#gm').isVisible(), true);
      const before = await page.evaluate(() => observatory.snapshot().bodies[0]);
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('w');
      const after = await page.evaluate(() => observatory.snapshot().bodies[0]);
      assert.ok(Math.abs(after.p[0] - before.p[0] - .05) < 1e-9);
      assert.ok(Math.abs(after.v[1] - before.v[1] - .001) < 1e-9);
      await page.keyboard.press('Delete');
      assert.equal(await page.evaluate(() => observatory.snapshot().bodies[0].deleted), true);
      await page.click('#gm-close');
      await page.evaluate(() => { observatory.test.reset(12); observatory.test.state().days = 365; observatory.test.advance(.001); });
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('threebody-seeds')).filter(r => r.seed === 12).length), 1);
      await page.evaluate(() => { observatory.test.reset(12); observatory.test.state().days = 3650; observatory.test.advance(.001); document.getElementById('auto').checked = false; });
      await page.waitForFunction(() => document.getElementById('death-title').textContent.includes('终于成为了现实'));
      const generation = await page.evaluate(() => observatory.snapshot().generation);
      await page.waitForFunction(g => observatory.snapshot().generation > g, generation, { timeout: 30000 });
      assert.equal(await page.evaluate(() => observatory.snapshot().paused), false);
      assert.deepEqual(errors, []);
      if (file.startsWith('wallpaper/') && process.argv.includes('--update-preview')) {
        // A dedicated 16:9 page, loaded fresh, so the Workshop thumbnail matches a
        // standard display and the era line reads 文明 001.
        const shot = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
        await shot.goto(pathToFileURL(path.resolve(file)).href + '?seed=12&test');
        await shot.waitForFunction(() => !!window.observatory, null, { timeout: 120000 });
        await shot.evaluate(() => observatory.test.setPause(true));
        await shot.waitForFunction(() => observatory.test.terrainReady(), null, { timeout: 120000 });
        await shot.waitForTimeout(3000);
        await shot.screenshot({ path: path.resolve('wallpaper/preview.jpg'), type: 'jpeg', quality: 88 });
        await shot.close();
      }
      await page.close();
      console.log('PASS browser:', file);
    }
    if (!process.argv.includes('--update-preview')) {
      assert.deepEqual(fs.readFileSync(path.resolve('wallpaper/preview.jpg')), previewBefore);
      console.log('PASS: preview.jpg unchanged');
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
