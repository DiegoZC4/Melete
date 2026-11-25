// Rasterize the actual selected take, including its SVG paint servers.
function snapshotEdge(path) {
  const group=path.parentElement.cloneNode(true),copy=group.querySelector('.bar-pitch-trace'),css=getComputedStyle(path);
  for(const style of ['fill','stroke-width','stroke-linecap','stroke-linejoin'])copy.setAttribute(style,css.getPropertyValue(style));
  const points=[0,1].map(t=>{const p=path.getPointAtLength(t*path.getTotalLength());return [p.x,p.y];});
  return {markup:new XMLSerializer().serializeToString(group),points};
}
async function rasterEdge({markup,points:[a,b]}) {
  const x=Math.floor(Math.min(a[0],b[0]))-4,y=Math.floor(Math.min(a[1],b[1]))-4;
  const w=Math.ceil(Math.max(a[0],b[0]))-x+4,h=Math.ceil(Math.max(a[1],b[1]))-y+4;
  async function samples(scale,errors) {
    const img=new Image(),svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${w*scale}" height="${h*scale}" viewBox="${x} ${y} ${w} ${h}">${markup}</svg>`;
    img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await img.decode();
    const cv=document.createElement('canvas');cv.width=w*scale;cv.height=h*scale;
    const c=cv.getContext('2d',{willReadFrequently:true});c.drawImage(img,0,0);
    return errors.map(e=>{const t=(e+100)/200;return [...c.getImageData(
      Math.floor((a[0]-x+t*(b[0]-a[0]))*scale),Math.floor((a[1]-y+t*(b[1]-a[1]))*scale),1,1).data];});
  }
  const natural=await samples(1,Array.from({length:101},(_,i)=>2*i-100));
  const families=[[0,255,0],[175,231,0],[246,187,0],[255,125,39],[255,15,5]];
  const bands=new Set(natural.filter(p=>p[3]>190).map(p=>families.map((f,i)=>[Math.hypot(...f.map((v,j)=>v-p[j])),i])
    .sort((a,b)=>a[0]-b[0])[0][1])).size;
  return {bands,colors:await samples(24,[-100,-88,-67,-50,-35,-25,0,25,35,50,67,88,100])};
}

function compareFigure() {
  const r=window.MeleteTakeRender;
  const svg=(tag,attrs={})=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
  const figure=svg('svg',{id:'contour-test-figure',width:610,height:158,viewBox:'0 0 610 158'});
  figure.style.cssText='position:fixed;left:0;top:0;z-index:2147483647;background:#1a201e;color:white;font:13px system-ui';
  const label=(x,y,s,color='#dedfdc',size=13)=>{const t=svg('text',{x,y,fill:color,'font-size':size});t.textContent=s;figure.append(t);};
  label(82,24,'One slide, from flat to sharp');label(297,24,'Held pitch error');
  const grades=[10,25,50,77,100];
  grades.forEach((e,i)=>label(298+i*60,47,e+'¢','#bec5c0',12));
  for(const [y,name,before] of [[79,'Before',true],[130,'After',false]]) {
    const half=9;
    label(13,y+4,name);figure.append(svg('rect',{x:82,y:y-half,width:176,height:2*half,fill:'#88a7b5',opacity:.8}));
    const line=(x1,y1,x2,y2,stroke)=>figure.append(svg('line',{x1,y1,x2,y2,stroke,'stroke-width':2.6,'stroke-linecap':'round'}));
    const a={x:82,y:y+half,tick:0,cents:5900,error:-100},b={x:258,y:y-half,tick:1,cents:6100,error:100};
    const old=e=>e<=10?'lime':e>=100?'red':`color-mix(in oklab,lime,red ${Math.round(e<=50?50*(e-10)/40:e)}%)`;
    line(a.x,a.y,b.x,b.y,before?old(100):r.svgPaint(figure,svg,a.x,0,b.x,0,r.edgeStops(a,b,r.color)));
    grades.forEach((e,i)=>{const x=298+i*60;figure.append(svg('rect',{x,y:y-half,width:42,height:2*half,fill:'#88a7b5',opacity:.8}));
      line(x,y-e*half/100,x+42,y-e*half/100,before?old(e):r.color(e));});
  }
  document.body.append(figure);
}
module.exports={snapshotEdge,rasterEdge,compareFigure};
