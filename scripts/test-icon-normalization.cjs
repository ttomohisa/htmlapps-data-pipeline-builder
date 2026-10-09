const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gunzipSync} = require('node:zlib');
const root = path.resolve(__dirname, '..');
const asset = fs.readFileSync(path.join(root, 'assets/favicon.svg'));
assert.equal(require('node:crypto').createHash('sha256').update(asset).digest('hex'), '1aba1d26877901b76b42a322b1b82cebb3dcada40f505307220e173395d45786', 'Preserve the normalized canonical artwork');
const svg = asset.toString();
const tag = svg.match(/<rect\b[^>]*>/)[0];
const a = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1],m[2]]));
assert.equal(a.fill.toLowerCase(), '#16624f', 'Canonical background brand green');
assert.equal(Number(a.rx), Number(a.width)/4, 'Exact horizontal quarter-radius');
assert.equal(Number(a.ry || a.rx), Number(a.height)/4, 'Exact vertical quarter-radius');
const decode = uri => uri.startsWith('data:image/svg+xml;base64,') ? Buffer.from(uri.split(',')[1], 'base64') : Buffer.from(decodeURIComponent(uri.slice(uri.indexOf(',')+1)));
const favicon = html => {
  const tag = html.match(/<link\b[^>]*rel=["']icon["'][^>]*>/)[0];
  assert.deepEqual(decode(tag.match(/href=(["'])(.*?)\1/s)[2]), asset, 'Canonical favicon byte parity');
};
const header = html => {
  const img = html.match(/<img\b[^>]*id="appBrandIcon"[^>]*>/);
  if (img) assert.deepEqual(decode(img[0].match(/src="([^"]*)"/)[1]), asset, 'Canonical header byte parity');
  else assert.ok(html.includes(svg.trim()), 'Inline header has canonical SVG');
};
const readable = fs.readFileSync(path.join(root, 'dist/index.html'));
for(const file of ['dist/index.html', 'data-pipeline-builder.html']) {const html=fs.readFileSync(path.join(root,file),'utf8');favicon(html);header(html);}
const source = fs.readFileSync(path.join(root,'src/index.template.html'),'utf8');
if(!source.includes('__APP_ICON_DATA_URI__')) {favicon(source);header(source);}
const wrapper=fs.readFileSync(path.join(root,'dist/index.self-extract.html'),'utf8');
favicon(wrapper);
const payload=wrapper.match(/<script id="self-extract-payload"[^>]*>([A-Za-z0-9+/=\s]+)<\/script>/);
assert.ok(payload,'Self-extract payload exists');
assert.deepEqual(gunzipSync(Buffer.from(payload[1],'base64')), readable, 'Self-extract restores exact readable bytes');
console.log('Icon color, exact quarter-radii, header/favicon/alias/loader parity passed.');
