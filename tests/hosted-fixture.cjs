const fs=require('node:fs'),http=require('node:http'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {fixture}=require('./browser-compatibility.cjs');
const {readCollection}=require('./collection-fixture.cjs');
async function hostedFixture(run) {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'melete-hosted-qa-'));
  let server;
  try {
    const source=fixture(tmp,{cloud:{api:'/melete/api.php'}}),dir=path.join(tmp,'hosted');
    execFileSync(process.env.PYTHON||'python3',[path.join(__dirname,'../offline_player.py'),source,'--output-dir',dir]);
    const types={'index.html':'text/html; charset=utf-8','melete-offline.js':'text/javascript','release.json':'application/json'};
    server=http.createServer((req,res)=>{
      const name=new URL(req.url,'http://localhost').pathname.slice(1)||'index.html';
      if(!Object.hasOwn(types,name)){res.writeHead(404);res.end();return;}
      res.writeHead(200,{'content-type':types[name],'cache-control':'no-store'});fs.createReadStream(path.join(dir,name)).pipe(res);
    });
    await new Promise((ok,bad)=>server.once('error',bad).listen(0,'127.0.0.1',ok));
    return await run('http://127.0.0.1:'+server.address().port+'/',readCollection(fs.readFileSync(source,'utf8')).songs);
  } finally {
    if(server)await new Promise(ok=>{server.close(ok);server.closeAllConnections();});
    fs.rmSync(tmp,{recursive:true,force:true});
  }
}
module.exports={hostedFixture};
