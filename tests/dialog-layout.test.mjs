import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';

const source = fs.readFileSync('src/index.template.html', 'utf8');
const artifacts = [['source', source]];
if (process.env.DIALOG_LAYOUT_HTML) artifacts.push(['selected artifact', fs.readFileSync(process.env.DIALOG_LAYOUT_HTML, 'utf8')]);
if (process.env.VERIFY_DIALOG_ARTIFACTS === '1') {
  const readable = fs.readFileSync('dist/index.html', 'utf8');
  const root = fs.readFileSync('data-pipeline-builder.html', 'utf8');
  const loader = fs.readFileSync('dist/index.self-extract.html', 'utf8');
  const payload = loader.match(/<script id="self-extract-payload" type="application\/octet-stream">([A-Za-z0-9+/=\r\n]+)<\/script>/)?.[1];
  assert.ok(payload, 'self-extract payload must exist');
  const restored = gunzipSync(Buffer.from(payload, 'base64')).toString('utf8');
  assert.equal(restored, readable, 'self-extract must restore exact readable bytes');
  const stable = html => html.replace(/("generatedAtUtc"\s*:\s*")[^"]*(")/g, '$1BUILD_TIME$2');
  assert.equal(stable(root), stable(readable), 'root and readable releases must agree');
  artifacts.push(['root', root], ['readable', readable], ['self-extracted', restored]);
}
// These structural regressions complement, and do not replace, native wheel/focus QA.
function rulesFor(html, selector) {
  const css = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].trim().split(',').some(part => part.trim() === selector))
    .map(match => match[2]);
}
function property(html, selector, name) {
  let value;
  for (const body of rulesFor(html, selector)) {
    for (const declaration of body.split(';')) {
      const colon = declaration.indexOf(':');
      if (declaration.slice(0, colon).trim() === name) value = declaration.slice(colon + 1).trim();
    }
  }
  return value;
}
for (const [label, html] of artifacts) {
  test(`${label}: native modal locks both document roots only while a modal is open`, () => {
    for (const selector of ['html:has(dialog:modal)', 'body:has(dialog:modal)']) {
      assert.equal(property(html, selector, 'overflow'), 'hidden', `${selector} must lock background scrolling`);
    }
    assert.equal(rulesFor(html, 'html:has(dialog[open])').length, 0, 'nonmodal open dialogs must not own the lock');
    assert.equal(rulesFor(html, 'body:has(dialog[open])').length, 0, 'nonmodal open dialogs must not own the lock');
  });
  test(`${label}: the custom expanded-workspace scroll lock is preserved`, () => {
    assert.equal(property(html, 'body.canvas-expanded', 'overflow'), 'hidden');
    assert.match(html, /classList\.toggle\('canvas-expanded',expanded\)/);
  });
  test(`${label}: existing local-processing badge retains its shield`, () => {
    const badge = html.match(/<div class="privacy-pill">([\s\S]*?)<\/div>/)?.[1];
    assert.ok(badge);
    assert.match(badge, /M12 3 5 6v5c0 4\.6 2\.8 8 7 10 4\.2-2 7-5\.4 7-10V6l-7-3Z/);
  });
}

test('canonical repository check explicitly requires dialog checks on every shipped form', () => {
  const check = fs.readFileSync('scripts/check-repository.ps1', 'utf8');
  assert.match(check, /\$env:VERIFY_DIALOG_ARTIFACTS\s*=\s*"1"/);
  assert.match(check, /\$previousDialogArtifactCheck\s*=\s*\$env:VERIFY_DIALOG_ARTIFACTS/);
  assert.match(check, /\$env:VERIFY_DIALOG_ARTIFACTS\s*=\s*\$previousDialogArtifactCheck/);
  assert.match(check, /node[^\r\n]*--test/);
});
