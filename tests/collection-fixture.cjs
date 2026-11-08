const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const dataTag = /(<script id="melete-collection-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
function readCollection(html) {
  const match = html.match(dataTag);
  assert.ok(match, 'built collection has the shared manifest');
  const bundle = JSON.parse(match[2]);
  const inflater = html.match(/<script id="melete-collection-inflater">([\s\S]*?)<\/script>/)[1];
  const assets = Object.fromEntries(Object.entries(bundle.assets).map(([key, value]) =>
    [key, value === null ? inflater : zlib.inflateSync(Buffer.from(value, 'base64')).toString('utf8')]));
  return {bundle, assets, songs:bundle.songs.map(song => ({...song, html:song.chunks.map(key => assets[key]).join('')}))};
}

function mapCollectionAssets(html, transform) {
  const {bundle, assets} = readCollection(html);
  for (const [key, value] of Object.entries(assets)) {
    if (key === bundle.inflater) continue;
    const changed = transform(value);
    if (changed !== value) bundle.assets[key] = zlib.deflateSync(Buffer.from(changed)).toString('base64');
  }
  return html.replace(dataTag, (_all, open, _json, close) => open + JSON.stringify(bundle).replace(/</g, '\\u003c') + close);
}

module.exports = {readCollection, mapCollectionAssets};
