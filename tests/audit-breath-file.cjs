// Read-only source audit. Optional output is a newly generated listening copy.
const fs=require('node:fs');
const path=require('node:path');
const pitch=require('../template/take_pitch.js');
const cleanup=require('../template/take_cleanup.js');
const {PitchDetector}=require('./pitch-fixture.cjs');
const [source,metadata,out]=process.argv.slice(2);
if(!source||!metadata||!out)throw Error('Usage: node audit-breath-file.cjs SOURCE.wav TAKE.json NEW_OUTPUT_DIR');
if(fs.existsSync(out))throw Error('Output directory already exists');
const wav=fs.readFileSync(source),take=JSON.parse(fs.readFileSync(metadata));
let data,format;
for(let p=12;p+8<=wav.length;){
  const n=wav.readUInt32LE(p+4),tag=wav.toString('ascii',p,p+4);
  if(tag==='fmt ')format={type:wav.readUInt16LE(p+8),channels:wav.readUInt16LE(p+10),rate:wav.readUInt32LE(p+12),bits:wav.readUInt16LE(p+22)};
  if(tag==='data')data={offset:p+8,length:n};p+=8+n+n%2;
}
if(format.type!==1||format.channels!==1||format.bits!==16)throw Error('Expected mono PCM16');
const pcm=Int16Array.from({length:data.length/2},(_,i)=>wav.readInt16LE(data.offset+2*i));
const frames=pitch.analyse(pcm,format.rate,take.pitchReference,PitchDetector,{includeFrames:true}).frames;
const ranges=cleanup.breathRanges(pcm,format.rate,frames,take.pitchReference);
const clean=cleanup.apply(pcm.slice(),format.rate,ranges);
const energy=(signal,a,b)=>signal.subarray(Math.round(a*format.rate),Math.round(b*format.rate)).reduce((s,x)=>s+x*x,0);
const report={source,version:cleanup.VERSION,settings:cleanup.SETTINGS,seconds:pcm.length/format.rate,
  detectedSeconds:ranges.reduce((s,[a,b])=>s+b-a,0),ranges:ranges.map(([a,b])=>({start:a,end:b,
    attenuationDb:10*Math.log10(Math.max(1,energy(clean,a,b))/Math.max(1,energy(pcm,a,b)))})),
  voicedSamplesChanged:0,sourceUnchanged:true};
for(const f of frames)if(Number.isFinite(f.cents)){
  const a=Math.max(0,Math.ceil((f.start+take.pitchReference.latency)*format.rate));
  const b=Math.min(pcm.length,Math.floor((f.end+take.pitchReference.latency)*format.rate));
  for(let i=a;i<b;i++)if(clean[i]!==pcm[i])report.voicedSamplesChanged++;
}
const output=Buffer.from(wav);
for(let i=0;i<clean.length;i++)output.writeInt16LE(clean[i],data.offset+2*i);
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'cleaned.wav'),output);
fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
