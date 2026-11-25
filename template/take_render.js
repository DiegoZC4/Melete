/* Display-only reductions. Saved detector frames and scoring never change. */
((root, factory) => {
  const api = factory(typeof module === "object" && module.exports ? require("./take_pitch.js") : root.MeleteTakePitch);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.MeleteTakeRender = api;
})(globalThis, pitch => {
  "use strict";
  const connects = pitch.connects;
  // In-gamut samples along the short OKLCH hue arc, with falling lightness.
  // Cents are spaced by OKLab arc length on each side of the 50-cent landmark.
  const knots = [[10,0x00ff00],[25,0xa4ea00],[35,0xcdda00],[42,0xe6cc00],
    [50,0xf8bb00],[59,0xffa609],[67,0xff922b],[77,0xff7829],[88,0xff541d],[100,0xff0000]];
  // CSS Color 4 OKLab matrices. Resolve once, including for offline SVGs.
  const rgb = n => [n>>16,(n>>8)&255,n&255];
  const rgbLab = n => {
    const [r,g,b]=rgb(n).map(c=>c/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
    const l=Math.cbrt(.4122214708*r+.5363325363*g+.0514459929*b);
    const m=Math.cbrt(.2119034982*r+.6806995451*g+.1073969566*b);
    const s=Math.cbrt(.0883024619*r+.2817188376*g+.6299787005*b);
    return [.2104542553*l+.793617785*m-.0040720468*s,1.9779984951*l-2.428592205*m+.4505937099*s,
      .0259040371*l+.7827717662*m-.808675766*s];
  };
  const labRgb = ([L,a,b]) => {
    const l=(L+.3963377774*a+.2158037573*b)**3, m=(L-.1055613458*a-.0638541728*b)**3, s=(L-.0894841775*a-1.291485548*b)**3;
    return [4.0767416621*l-3.3077115913*m+.2309699292*s,-1.2684380046*l+2.6097574011*m-.3413193965*s,
      -.0041960863*l-.7034186147*m+1.707614701*s].map(c=>Math.round(255*Math.min(1,Math.max(0,c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055))));
  };
  const labs=knots.map(k=>rgbLab(k[1])), vectors=new Map();
  const ink = Array.from({length:201}, (_, i) => {
    const e = i / 2, hi = knots.findIndex(([v]) => v >= e);
    const t=hi?(e-knots[hi-1][0])/(knots[hi][0]-knots[hi-1][0]):0;
    const v=hi===0||e===knots[hi][0]?rgb(knots[hi][1]):labRgb(labs[hi-1].map((a,j)=>a+(labs[hi][j]-a)*t));
    const css=hi===0||e===100?`rgb(${v.join(" ")})`:"#"+v.map(c=>c.toString(16).padStart(2,"0")).join("");
    vectors.set(css,v);return css;
  });
  function color(error) {
    if (error === "preparation") return "var(--muted)";
    if (!Number.isFinite(error)) return ink[200];
    const e = Math.abs(pitch.octaveError(error));
    return ink[e <= 10 ? 20 : e >= 100 ? 200 : Math.max(21, Math.min(199, Math.round(e*2)))];
  }
  const landmarks = [...new Set([10.5,11,12,98,99,99.5,...knots.map(k => k[0]), ...Array.from({length:19}, (_, i) => 10+i*5)])];
  const signedStops = landmarks.flatMap(e => [-e,e]).sort((a,b) => a-b);
  const target = (cents,error) => Number.isFinite(error) ? Math.round((cents-error)/100)*100 : error;
  function addStop(stops, at, paint) {
    const n = stops.length, last = stops[n-1];
    if (last?.[1] === paint) {
      if (last[0] === at) return;
      if (n > 1 && stops[n-2][1] === paint) { last[0] = at; return; }
    }
    stops.push([at,paint]);
  }
  function edgeStops(a,b,colorAt,errorAt) {
    const stops = [], delta = b.cents-a.cents;
    const left = target(a.cents,a.error), right = target(b.cents,b.error);
    if (left === right && a.error === b.error) {
      const paint = colorAt(a.error);
      return [[0,paint],[1,paint]];
    }
    const put = (t,e) => addStop(stops,t,colorAt(e));
    if (left === right) {
      const ea=a.error, eb=b.error;
      put(0,ea);
      if (Math.max(ea,eb)>-100 && Math.min(ea,eb)<100 && Math.abs(eb-ea)>1) {
        for (let i=0;i<signedStops.length;i++) {
          const e = signedStops[eb >= ea ? i : signedStops.length-1-i];
          if (e>Math.min(ea,eb) && e<Math.max(ea,eb)) put((e-ea)/(eb-ea),e);
        }
      }
      put(1,eb);
    } else {
      // Don't smear a reference change backward over the old note. Duplicate
      // gradient stops at the score boundary give it a genuinely sharp change.
      if (colorAt(a.error)===colorAt(b.error)) return [[0,colorAt(a.error)],[1,colorAt(b.error)]];
      let lo=0, hi=1;
      if (errorAt) for (let i=0;i<10;i++) {
        const t=(lo+hi)/2, cents=a.cents+delta*t, tick=a.tick+(b.tick-a.tick)*t;
        if (target(cents,errorAt(tick,cents))===left) lo=t; else hi=t;
      }
      const split=errorAt?(lo+hi)/2:0.5;
      put(0,a.error); put(split,a.error); put(split,b.error); put(1,b.error);
    }
    return stops;
  }
  let paintSerial = 0;
  function thinStops(stops) {
    if (stops.length<3) return stops;
    const out=[];
    // SVG interpolates these stops in sRGB. Remove intermediate stops only if
    // every channel remains within four 8-bit levels of the requested color.
    function reduce(a,b) {
      let split=-1, worst=4;
      const va=vectors.get(stops[a][1]), vb=vectors.get(stops[b][1]);
      for (let i=a+1;i<b;i++) {
        const v=vectors.get(stops[i][1]);
        if (!v || !va || !vb) {split=i;break;}
        const t=(stops[i][0]-stops[a][0])/(stops[b][0]-stops[a][0]);
        const err=Math.max(...v.map((c,j)=>Math.abs(c-(va[j]+(vb[j]-va[j])*t))));
        if (err>worst) {worst=err;split=i;}
      }
      if (split<0) return;
      reduce(a,split);out.push(stops[split]);reduce(split,b);
    }
    let start=0; out.push(stops[0]);
    for(let i=1;i<=stops.length;i++) {
      if(i<stops.length && stops[i][0]!==stops[i-1][0])continue;
      reduce(start,i-1);
      if(i-1>start)out.push(stops[i-1]);
      if(i<stops.length)out.push(stops[i]);
      start=i;
    }
    return out;
  }
  function svgPaint(parent, svg, x1, y1, x2, y2, stops) {
    if (stops.every(s => s[1]===stops[0][1])) return stops[0][1];
    const a=vectors.get(stops[0][1]);
    if (a && Math.hypot(x2-x1,y2-y1)<2 && stops.every(s=>vectors.get(s[1])?.every((v,j)=>Math.abs(v-a[j])<=6)))
      return stops[0][1];
    const id = "melete-trace-ink-" + (++paintSerial);
    const grad = svg("linearGradient", {id,gradientUnits:"userSpaceOnUse","color-interpolation":"sRGB",x1,y1,x2,y2});
    for (const [offset,paint] of thinStops(stops)) grad.append(svg("stop", {offset,"stop-color":paint}));
    parent.append(grad);
    return `url(#${id})`;
  }
  // Live and saved traces share one display rule. Detector window widths are
  // not silence boundaries: the browser can deliver voiced samples irregularly.
  function frameRange(frames, from, to) {
    const lower = value => {
      let lo = 0, hi = frames.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1, f = frames[mid];
        if ((f.start + f.end) / 2 < value) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    return [lower(from), lower(to + 1e-9)];
  }
  function tracePaths(frames, from, to, pointAt, colorAt, {rate = 1, errorAt} = {}) {
    const colors = new Map(), ramps = [];
    let previous = null, halo = "", edges = 0, run;
    function flush() {
      if (!run) return;
      const {x1,y1,x2,y2,d,stops} = run, paint=stops[0][1];
      if (stops.every(s => s[1]===paint)) colors.set(paint,(colors.get(paint)||"")+d);
      else ramps.push({x1,y1,x2,y2,d,stops:stops.map(([at,c])=>[(at-run.start)/(run.end-run.start),c])});
      run=null;
    }
    for (let i = from; i < to; i++) {
      const frame = frames[i];
      if (!Number.isFinite(frame.cents)) { flush(); previous = null; continue; }
      let point = pointAt(frame);
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) { flush(); previous = null; continue; }
      if (point.cents === undefined) point = {...point,cents:frame.cents};
      const seconds = (frame.start + frame.end) / 2 * rate;
      if (previous && previous.point.track === point.track && frame.takeId === previous.frame.takeId
        && connects(previous.seconds, previous.frame.cents, seconds, frame.cents)) {
        // Match live continuity without bridging explicit unvoiced frames,
        // large pitch jumps, long dropouts, hidden points or comp splices.
        // Separate subpaths retain every edge, including gaps and source changes.
        const edge = `M${previous.point.x.toFixed(3)} ${previous.point.y.toFixed(3)}L${point.x.toFixed(3)} ${point.y.toFixed(3)}`;
        const a = previous.point, dx=point.x-a.x, dy=point.y-a.y;
        const stops = edgeStops(a,point,colorAt,errorAt);
        // A steep slide may occupy a fraction of one horizontal pixel. Paint
        // along its actual direction; group ordinary time-monotonic runs.
        const steep = dx <= 0 || Math.abs(dy)>dx;
        if (steep || run?.count===64) flush();
        const start=steep?0:a.x, end=steep?1:point.x;
        if (!run) run={x1:a.x,y1:steep?a.y:0,start,stops:[],d:"",count:0};
        for (const [t,paint] of stops) addStop(run.stops,start+(end-start)*t,paint);
        Object.assign(run,{x2:point.x,y2:steep?point.y:0,end});
        run.d+=edge; run.count++;
        if (steep) flush();
        halo += edge; edges++;
      } else flush();
      previous = {frame, point, seconds};
    }
    flush();
    return {colors: [...colors], ramps, halo, edges};
  }
  return {connects, color, edgeStops, svgPaint, frameRange, tracePaths};
});
