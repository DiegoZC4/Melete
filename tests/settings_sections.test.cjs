const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const app = fs.readFileSync(path.join(__dirname, '../template/app.js'), 'utf8');

function fixture(value = null, blocked = false) {
  const calls = [], key = 'choir-practice:mobile-sections:v1';
  const stored = new Map(value === null ? [] : [[key, value]]);
  const groups = new Map(['parts', 'practice', 'display', 'tools', 'takes'].map(name => {
    const classes = new Set();
    return [name, {group: {classList: {contains: v => classes.has(v), toggle(v, on) {on ? classes.add(v) : classes.delete(v);}}},
      body: {inert: false, contains: () => false},
      toggle: {setAttribute(name, value) {this[name] = value;}, focus() {calls.push('focus');}}}];
  }));
  const c = vm.createContext({settingsSections: groups, settingsSectionsKey: key,
    mobileSectionOpen: {}, settingsSectionsMedia: {matches: true},
    document: {activeElement: null}, ready: true, elements: {takeActions: {open: true}},
    requestAnimationFrame() {}, updateTransportHeight() {},
    cancelTakeScoring() {calls.push('cancel');}, stopTakePreview() {calls.push('preview');}, scoreNextTake() {calls.push('score');},
    localStorage: {
      getItem(key) {if (blocked) throw new Error('blocked'); return stored.get(key) ?? null;},
      setItem(key, value) {if (blocked) throw new Error('blocked'); stored.set(key, value);},
    },
  });
  for (const name of ['readSettingsSections', 'settingsSectionCollapsed', 'syncSettingsSections', 'setSettingsSection']) {
    vm.runInContext(app.match(new RegExp(`  function ${name}\\([^]*?\\n  }`))[0], c);
  }
  c.readSettingsSections(); c.syncSettingsSections(); calls.length = 0;
  return {c, groups, calls, stored, key};
}

test('mobile sections default to Practice only and accept only known boolean preferences', () => {
  for (const value of [null, 'bad json', 'null', '[]', '{"parts":"false","practice":7,"unknown":true}']) {
    const {c} = fixture(value);
    for (const key of ['parts','practice','display','tools','takes']) assert.equal(c.settingsSectionCollapsed(key), key !== 'practice');
  }
  const {c} = fixture('{"parts":true,"practice":false,"takes":true}');
  assert.equal(c.settingsSectionCollapsed('parts'), false);
  assert.equal(c.settingsSectionCollapsed('practice'), true);
  assert.equal(c.settingsSectionCollapsed('takes'), false);
});

test('desktop exposes controls without destroying remembered mobile choices', () => {
  const {c, groups, stored, key} = fixture();
  c.setSettingsSection('tools', true);
  const preference = stored.get(key);
  c.settingsSectionsMedia.matches = false;
  c.syncSettingsSections();
  for (const name of groups.keys()) {
    assert.equal(c.settingsSectionCollapsed(name), false);
    assert.equal(groups.get(name).body.inert, false);
  }
  assert.equal(stored.get(key), preference);
  c.settingsSectionsMedia.matches = true;
  c.syncSettingsSections();
  assert.equal(c.settingsSectionCollapsed('parts'), true);
  assert.equal(c.settingsSectionCollapsed('tools'), false);
});

test('folding Takes keeps background scoring, main-player review and capture running', () => {
  const {c, calls, groups, stored, key} = fixture();
  c.setSettingsSection('takes', true);
  assert.deepEqual(calls, ['score']);
  calls.length = 0;
  groups.get('takes').body.contains = () => true;
  c.setSettingsSection('takes', false);
  assert.deepEqual(calls, ['focus']);
  assert.equal(c.elements.takeActions.open, false);
  const preference = stored.get(key);
  c.setSettingsSection('takes', true, {persist: false});
  assert.equal(stored.get(key), preference);
  assert.equal(c.settingsSectionCollapsed('takes'), false);
});

test('blocked storage never prevents opening folded controls', () => {
  const {c} = fixture(null, true);
  c.setSettingsSection('parts', true);
  assert.equal(c.settingsSectionCollapsed('parts'), false);
});
