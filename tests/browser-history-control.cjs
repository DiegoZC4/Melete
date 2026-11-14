async function historyControl(frame,action){
  if(await frame.evaluate(()=>matchMedia('(hover:hover) and (pointer:fine)').matches)){
    await frame.locator('body').press(action==='undo'?'Control+z':'Control+Shift+z');
  }else await frame.locator('#'+action+'Comp').click();
}
module.exports={historyControl};
