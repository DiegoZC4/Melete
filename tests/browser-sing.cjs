// Sing arms local audio and pitch; the transport starts and stops the pass.
async function choosePart(frame, index = null) {
  if (index === null && await frame.locator('[data-visible-index][aria-pressed="true"]').count() === 1) return;
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const heading = frame.locator('[data-settings-section="parts"] .settings-section-toggle');
  if (await heading.isVisible() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  const target=frame.locator(`[data-visible-index="${index ?? 0}"]`);
  if(await target.getAttribute('aria-pressed')==='true' && await frame.locator('[data-visible-index][aria-pressed="true"]').count()===1)return;
  await target.press('Shift+Enter');
}
async function nextPart(frame) {
  const cells=frame.locator('[data-visible-index]'),count=await cells.count();
  const visible=frame.locator('[data-visible-index][aria-pressed="true"]');
  const selected=await visible.count()===1 ? Number(await visible.getAttribute('data-visible-index')) : -1;
  await choosePart(frame,(selected+1)%count);
}
async function enableSing(frame) {
  await choosePart(frame);
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const heading = frame.locator('[data-settings-section="practice"] .settings-section-toggle');
  if (await heading.isVisible() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  if (await frame.locator('#pitchCapture').getAttribute('aria-pressed') !== 'true') await frame.locator('#pitchCapture').click();
}
async function startRecording(frame) {
  await choosePart(frame);
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const heading=frame.locator('[data-settings-section="practice"] .settings-section-toggle');
  if(await heading.isVisible() && await heading.getAttribute('aria-expanded')==='false') await heading.click();
  if(await frame.locator('#pitchCapture').getAttribute('aria-pressed')!=='true') await frame.locator('#pitchCapture').click();
  await frame.locator('#playPause').click();
}
async function stopRecording(frame) {
  if (await frame.locator('#pitchCapture').getAttribute('aria-pressed') === 'true') await frame.locator('#pitchCapture').click();
  await frame.waitForFunction(() => (window.__qa || window.__probe).recording.state === 'off');
  // Most recorder fixtures expect transport parked too. Sing-off itself does not pause it.
  if (await frame.locator('#playPause').getAttribute('aria-label') !== 'Play score') await frame.locator('#playPause').click();
}
async function toggleRecording(frame) {
  const active = await frame.evaluate(() => (window.__qa || window.__probe).recording.state !== 'off');
  return active ? stopRecording(frame) : startRecording(frame);
}
async function deleteUnused(frame) {
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const heading = frame.locator('[data-settings-section="takes"] .settings-section-toggle');
  if (await heading.isVisible() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await frame.locator('#deleteLooseTakes').click();
}
module.exports = {choosePart, nextPart, enableSing, startRecording, stopRecording, toggleRecording, deleteUnused};
