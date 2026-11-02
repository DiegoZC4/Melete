// Exercise the single public Sing toggle and ordinary transport, not private capture APIs.
async function enableSing(frame) {
  if (await frame.locator('#settingsToggle').getAttribute('aria-expanded') !== 'true') await frame.locator('#settingsToggle').click();
  const heading = frame.locator('[data-settings-section="practice"] .settings-section-toggle');
  if (await heading.isVisible() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  if (await frame.locator('#pitchCapture').getAttribute('aria-pressed') !== 'true') await frame.locator('#pitchCapture').click();
}
async function startRecording(frame) {
  await enableSing(frame);
  if (await frame.locator('#playPause').getAttribute('aria-label') === 'Play score') await frame.locator('#playPause').click();
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
  const heading = frame.locator('[data-settings-section="takes"] .settings-section-toggle');
  if (await heading.isVisible() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
  await frame.locator('#deleteLooseTakes').click();
}
module.exports = {enableSing, startRecording, stopRecording, toggleRecording, deleteUnused};
