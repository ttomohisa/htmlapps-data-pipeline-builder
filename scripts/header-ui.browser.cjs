// Focused native header QA; device capture/data processing are not exercised here.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'app.config.json'), 'utf8'));
const evidence = path.resolve(root, 'test-results/header-ui');
const scanner = false;
async function main() {
  fs.mkdirSync(evidence, {recursive: true});
  const browser = await chromium.launch();
  try {
    for (const language of ['ja', 'en']) for (const [width, height] of [[320,568],[360,640],[390,844],[1360,900]]) {
      const context = await browser.newContext({viewport:{width,height}, locale:language, reducedMotion:'reduce'});
      const page = await context.newPage(), errors = [], requests = [];
      const label = `${language}-${width}`;
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
      try {
        await page.goto(pathToFileURL(path.join(root, 'dist/index.html')).href);
        const phone = scanner && width <= 600;
        const languageButton = page.locator(phone ? '#mobileLangBtn' : '#langBtn');
        await languageButton.waitFor();
        if (await page.locator('html').getAttribute('lang') !== language) await languageButton.click();
        const version = page.locator(phone ? '.mobile-camera-title .version-badge' : scanner ? 'header .version-badge' : 'header .version');
        assert.equal(await version.isVisible(), true, label + ': visible version');
        assert.equal((await version.textContent()).trim(), 'v' + config.version, label + ': configured version');
        assert.ok(await version.evaluate(el => {
          const r = el.getBoundingClientRect();
          if (r.left < 0 || r.right > innerWidth || el.scrollWidth > el.clientWidth + 1) return false;
          for (let p = el.parentElement; p; p = p.parentElement) {
            if (/hidden|clip/.test(getComputedStyle(p).overflowX)) {
              const b = p.getBoundingClientRect();
              if (r.left < b.left - 1 || r.right > b.right + 1) return false;
            }
          }
          return true;
        }), label + ': version is not clipped');
        const actions = page.locator(phone ? '.mobile-camera-actions' : '.header-actions');
        const vr = await version.boundingBox(), ar = await actions.boundingBox();
        assert.ok(vr.x + vr.width <= ar.x + 1, label + ': version does not overlap controls');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label + ': no page overflow');
        await page.screenshot({path:path.join(evidence, label + '.png')});
        const help = page.locator(phone ? '#mobileHelpBtn' : '#helpBtn');
        await help.click();
        assert.equal(await page.locator('#helpDialog').isVisible(), true, label + ': Help opens');
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#helpDialog').isVisible(), false, label + ': Help closes');
        await languageButton.click();
        await languageButton.click();
        assert.equal((await version.textContent()).trim(), 'v' + config.version, label + ': repeated language switches preserve version');
        assert.deepEqual(errors, [], label + ': no runtime errors');
        assert.deepEqual(requests, [], label + ': no external requests');
        console.log('PASS ' + label);
      } catch (error) {
        await page.screenshot({path:path.join(evidence, 'failure-' + label + '.png')}).catch(() => {});
        throw error;
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
