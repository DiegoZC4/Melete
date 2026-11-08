const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('corrupt or incomplete collection manifests fail visibly before starting any player',()=>{
  const runtime=fs.readFileSync(path.join(__dirname,'../template/collection.js'),'utf8');
  for(const text of ['{','[]','{}',JSON.stringify({version:1,assets:{},songs:[{id:'a',title:'A',chunks:['missing']}]})]) {
    const loading={},errors=[];
    vm.runInNewContext(runtime,{
      document:{documentElement:{outerHTML:''},getElementById:id=>id==='loading'?loading:{textContent:text}},
      console:{error:(...args)=>errors.push(args)},
    },{timeout:1000});
    assert.match(loading.textContent,/incomplete/);
    assert.equal(errors.length,1);
  }
});
