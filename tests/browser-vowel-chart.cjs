const assert = require('node:assert/strict');
const {vowels} = require('./vowel-fixture.cjs');

// Observe the actual, unprojected frames that the offline preview renders.
async function observeFrames(frame) {
  await frame.evaluate(() => {
    if (window.vowelChartFrames) return;
    window.vowelChartFrames={};
    for (const method of ['strokes','referenceExample','referenceRegion']) {
      const calculate=MeleteVowels[method];
      MeleteVowels[method]=(...args)=>{
        const value=calculate(...args);
        window.vowelChartFrames[method]=value;
        return value;
      };
    }
  });
}

async function checkChart(frame) {
  const drawn=await frame.evaluate(()=>{
    const chart=document.querySelector('#vowelChart'), panel=document.querySelector('#vowelPanel');
    const attrs=(node,names)=>names.map(name=>Number(node.getAttribute(name)));
    const box=node=>{
      const {left,top,right,bottom}=node.getBoundingClientRect();
      return {left,top,right,bottom};
    };
    const overlay=selector=>{
      const group=chart.querySelector(selector);
      return {
        paths:[...group.querySelectorAll('path')].map(p=>p.getAttribute('d').match(/-?[\d.]+/g).map(Number)),
        samples:[...group.querySelectorAll('.vowel-sample')].map(c=>attrs(c,['cx','cy'])),
        marks:[...group.querySelectorAll('.vowel-beat')].map(c=>attrs(c,['cx','cy'])),
      };
    };
    return {
      field:attrs(chart.querySelector('.vowel-field'),['x','y','width','height']),
      ticks:[...chart.querySelectorAll('.vowel-tick')].map(t=>({
        hz:Number(t.textContent),label:attrs(t,['x','y']),line:attrs(t.previousElementSibling,['x1','y1','x2','y2']),
      })),
      axes:[...chart.querySelectorAll(':scope > text')].map(t=>t.textContent),
      liveMarkers:[...chart.querySelectorAll('circle,ellipse,line,path,polygon,polyline,rect')]
        .filter(el=>!el.closest('#vowelScale,#vowelReference,#vowelTrail,#vowelTarget')).map(el=>el.id),
      viewport:box(chart),
      axisBoxes:[...chart.querySelectorAll(':scope > text, .vowel-tick')].map(t=>({text:t.textContent,...box(t)})),
      labels:panel.textContent+' '+[...panel.querySelectorAll('[aria-label]')].map(n=>n.getAttribute('aria-label')).join(' '),
      landmarks:[...chart.querySelectorAll('.vowel-landmark')].map(t=>[t.textContent,attrs(t,['x','y'])]),
      readout:document.querySelector('#vowelHz').textContent,
      dot:attrs(chart.querySelector('#vowelDot[visibility="visible"]'),['cx','cy']),
      trail:overlay('#vowelTrail'), reference:overlay('#vowelReference'),
      region:attrs(chart.querySelector('.vowel-region'),['x','y','width','height']),
      raw:window.vowelChartFrames,
    };
  });

  // Independent oracle from the published equation, with precomputed axis endpoints.
  const bark=hz=>13*Math.atan(.76*hz/1000)+3.5*Math.atan((hz/7500)**2);
  const [left,top,width,height]=drawn.field;
  const project=({f1,f2})=>[
    left+width*(16.496129041-bark(f2))/(16.496129041-4.736466582),
    top+height*(bark(f1)-1.720817648)/(9.974113041-1.720817648),
  ];
  let maxError=0;
  function close(actual,expected) {
    assert.equal(actual.length,expected.length);
    actual.forEach((n,i)=>{
      const error=Math.abs(n-expected[i]);
      assert.ok(error<.011,'SVG coordinate '+n+' should be '+expected[i]);
      maxError=Math.max(maxError,error);
    });
  }
  close([width/(16.496129041-4.736466582)],[height/(9.974113041-1.720817648)]);
  assert.deepEqual(drawn.axes,['← F2 (Hz)','← F1 (Hz)']);
  assert.deepEqual(drawn.liveMarkers,['vowelDot']);
  const viewport=drawn.viewport;
  for (const [i,a] of drawn.axisBoxes.entries()) {
    assert.ok(a.left>=viewport.left-1 && a.right<=viewport.right+1 && a.top>=viewport.top-1 && a.bottom<=viewport.bottom+1,
      a.text+' is clipped');
    for (const b of drawn.axisBoxes.slice(i+1)) {
      const overlapX=Math.min(a.right,b.right)-Math.max(a.left,b.left);
      const overlapY=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
      assert.ok(overlapX<1 || overlapY<1, a.text+' overlaps '+b.text);
    }
  }
  assert.match(drawn.labels,/Bark spacing/);
  assert.doesNotMatch(drawn.labels,/\bF[0₀]|fundamental/i);
  const ticks={f1:[],f2:[]};
  for (const {hz,label,line} of drawn.ticks) {
    if (line[0]===line[2]) {
      const [x]=project({f1:175,f2:hz});
      close(line,[x,top,x,top+height]);close([label[0]],[x]);ticks.f2.push(hz);
    } else {
      const [,y]=project({f1:hz,f2:3500});
      close(line,[left,y,left+width,y]);close([label[1]],[y]);ticks.f1.push(hz);
    }
  }
  assert.deepEqual(ticks,{f1:[175,400,600,800,1000,1250],f2:[500,1000,1500,2000,2500,3500]});
  assert.deepEqual(drawn.landmarks.map(([name])=>name).sort(),['ah','ee','oo']);
  for (const [name,xy] of drawn.landmarks) {
    const [f1,f2]=vowels[name];
    close(xy,project({f1,f2}));
  }
  const hz=drawn.readout.match(/^F1 (\d+) Hz · F2 (\d+) Hz$/);
  assert.ok(hz,drawn.readout);
  close(drawn.dot,project({f1:Number(hz[1]),f2:Number(hz[2])}));
  const {low1,high1,low2,high2}=drawn.raw.referenceRegion;
  const [x,y]=project({f1:low1,f2:high2}), [right,bottom]=project({f1:high1,f2:low2});
  close(drawn.region,[x,y,right-x,bottom-y]);

  function checkPaths(overlay,runs,live) {
    const paths=[], samples=[], marks=[];
    for (const run of runs) {
      const points=run.map(project);
      if (live || points.length===1) samples.push(points[0]);
      if (live) {
        for (let i=1; i<points.length; ++i) paths.push([...points[i-1],...points[i]]);
      } else if (points.length>1) paths.push(points.flat());
      const onset=live ? run[0].onset : 0;
      const firstMark=onset+250*(1+Math.floor((run[0].t-onset)/250));
      for (let t=firstMark; t<=run.at(-1).t; t+=250) {
        const i=run.findIndex(p=>p.t>=t), a=run[i-1], b=run[i];
        const k=(t-a.t)/(b.t-a.t);
        marks.push(project({f1:a.f1+k*(b.f1-a.f1),f2:a.f2+k*(b.f2-a.f2)}));
      }
    }
    for (const [actual,expected] of [[overlay.paths,paths],[overlay.samples,samples],[overlay.marks,marks]]) {
      assert.equal(actual.length,expected.length);
      actual.forEach((item,i)=>close(item,expected[i]));
    }
  }
  checkPaths(drawn.trail,drawn.raw.strokes,true);
  checkPaths(drawn.reference,drawn.raw.referenceExample.runs,false);
  assert.ok(drawn.trail.paths.length && drawn.reference.paths.length && drawn.reference.marks.length);
  return {hzTicks:ticks,landmarks:drawn.landmarks.length,referenceTimeMarks:drawn.reference.marks.length,
    liveSegments:drawn.trail.paths.length,readout:drawn.readout,maxSvgError:Number(maxError.toFixed(5))};
}

module.exports={observeFrames,checkChart};
