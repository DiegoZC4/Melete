// Periodic glottal excitation through three cascaded two-pole resonators.
const vowels = {ee:[300,2350], ah:[780,1250], oo:[350,830]};
function vowelPCM(formants, f0=120, rate=48000, seconds=.14, moveTo=null) {
  const samples = new Float32Array(Math.round(rate*seconds));
  const states = [...formants,3000].map((hz,i) => {
    const radius=Math.exp(-Math.PI*[65,95,160][i]/rate);
    return {a:2*radius*Math.cos(2*Math.PI*hz/rate), radius, b:radius*radius, y:0, z:0};
  });
  let phase=0, last=0;
  for(let i=0; i<samples.length; ++i) {
    if (moveTo && i%24===0) {
      const amount=Math.max(0,Math.min(1,(i/rate-moveTo.start)/moveTo.duration));
      for (let j=0;j<formants.length;++j) {
        const hz=formants[j]+amount*(moveTo.formants[j]-formants[j]);
        states[j].a=2*states[j].radius*Math.cos(2*Math.PI*hz/rate);
      }
    }
    phase+=f0/rate;
    let excitation=0;
    if (phase>=1) { phase-=1; excitation=1; }
    // Glottal rolloff ahead of the independent vocal-tract filter.
    last=.82*last+excitation;
    let v=last;
    for(const s of states) {
      const out=v+s.a*s.y-s.b*s.z; s.z=s.y; s.y=out; v=out;
    }
    samples[i]=v;
  }
  let peak=0;
  for(const x of samples) peak=Math.max(peak,Math.abs(x));
  return samples.map(x=>.24*x/peak);
}
module.exports={vowels,vowelPCM};
