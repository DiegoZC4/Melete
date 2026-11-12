const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const archive=require('../tools/local_station/library_archive.js');
const {loadSession}=require('../tools/local_station/export_review.cjs');
test('review export reads modern typed contours and exact PCM from a library backup',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'melete-export-unit-'));
  try{
    const contour=new Float32Array([0,.01,6012]),pcm=new Int16Array([-32000,0,32767]);
    const data={preferences:{},stores:{takes:[['id',{id:'id',pitchContour:{pitches:contour}}]],
      chunks:[[['id',0],{takeId:'id',pcm}]],comps:[['key',{segments:[{takeId:'id',from:0,to:1}]}]],counters:[]}};
    const file=path.join(dir,'library.melete');await fs.writeFile(file,new Uint8Array(await archive.pack(data).arrayBuffer()));
    const result=loadSession(file);
    assert.deepEqual(result.takes[0].pitchContour.pitches,contour);
    assert.deepEqual(result.chunks[0].pcm,Buffer.from(pcm.buffer));
    assert.equal(result.comps[0].segments[0].takeId,'id');
    assert.throws(()=>loadSession(file,'incorrect'),/different recording library/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
