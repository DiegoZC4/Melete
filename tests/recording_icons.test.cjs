const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../template/index.html'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../template/styles.css'),'utf8');

test('YouTube is an unfilled outline; microphone owns the recording red',()=>{
  const youtube=html.slice(html.indexOf('id="demoVideo"'),html.indexOf('class="practice-files"'));
  assert.doesNotMatch(youtube,/fill="(?!none)[^"]+"|<rect/);
  assert.match(css,/\.icon-button\.display-demo svg\s*\{[^}]*fill: none;[^}]*stroke: currentColor;/);
  assert.match(css,/\.practice-group \.sing-control svg\s*\{[^}]*color:var\(--recording-red\)/);
  assert.match(css,/--recording-red: #[\da-f]{6}/);
  assert.match(css,/\.binary-icon-button\.is-recording svg\s*\{[^}]*var\(--recording-red\)/);
});
