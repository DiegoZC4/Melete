async function showAllColumns(frame){
  await frame.locator('#takeFields').click();
  await frame.locator('#allTakeFields').click();
  await frame.locator('#allTakeFields').press('Escape');
}
module.exports={showAllColumns};
