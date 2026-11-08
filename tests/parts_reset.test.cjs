const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');
function source(name) {
  const start = app.indexOf(`  function ${name}(`);
  assert.ok(start >= 0, name);
  return app.slice(start, app.indexOf('\n  }', start) + 4);
}
const plain = value => JSON.parse(JSON.stringify(value));

test('the Parts reset shows every See channel, not just every staff', () => {
  // Autumn's shape: four staves and seven channels, with Tenor's two lines hidden.
  const parts = ['S', 'A', 'T', 'B'].map(short => ({short}));
  const mixerParts = [[0, null], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]].map(([source, line]) => ({source, line}));
  const resets = new Map();
  const context = vm.createContext({
    parts, mixerParts, visibleChannels: new Set(), visibleTracks: new Set([0, 1, 3]), elements: {},
    settingsSections: new Map(), document: {getElementById: id => ({id}), querySelector: selector => ({selector})},
    registerResetTarget(element, label, mutate) { if (element?.id === 'partsLabel') resets.set(label, mutate); },
  });
  vm.runInContext(`${source('registerStaticResetTargets')}\n${source('restoreVisibleChannels')}\nregisterStaticResetTargets();`, context);
  const state = {practicePart: null, practiceDivisi: [null, null, 1, null], visible: [true, true, false, true],
    visibleChannels: [true, true, true, false, false, true, true], audible: mixerParts.map((_, index) => index !== 6),
    volumes: [150, 100, 100, 100, 100, 100, 100], pans: [0, 0, 0, 0, 0, 0, 30], practiceMixMode: 'learn', practiceMixUndo: {}};
  resets.get('Parts')(state, {volumes: mixerParts.map(() => 100), pans: mixerParts.map(() => 0)});
  assert.deepEqual(plain(state.visibleChannels), mixerParts.map(() => true));
  assert.deepEqual(plain(state.visible), parts.map(() => true));
  assert.deepEqual(plain(state.audible), mixerParts.map(() => true));
  assert.deepEqual(plain(state.volumes), mixerParts.map(() => 100));
  assert.deepEqual(plain(state.pans), mixerParts.map(() => 0));
  assert.deepEqual(plain(state.practiceDivisi), parts.map(() => null));
  assert.equal(state.practiceMixMode, null);
  // Applying the state restores See from visibleChannels whenever its length matches.
  context.restoreVisibleChannels(state);
  assert.deepEqual([...context.visibleChannels].sort(), mixerParts.map((_, index) => index));
});
