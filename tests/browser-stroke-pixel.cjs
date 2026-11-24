// Computed SVG paint can be serialized as rgb() or oklab(). Compare its actual sRGB output.
function strokePixel(element) {
  const c=document.createElement('canvas');c.width=c.height=1;
  const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(element).stroke;ctx.fillRect(0,0,1,1);
  const [r,g,b]=ctx.getImageData(0,0,1,1).data;return 'rgb('+r+', '+g+', '+b+')';
}
module.exports={strokePixel};
