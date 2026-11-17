import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const journal = new URL('./.private/ratings/revisions.ndjson', import.meta.url);
async function journalHash() {
  try { return createHash('sha256').update(await readFile(journal)).digest('hex'); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
const before = await journalHash();
const { username, password } = JSON.parse(await readFile(new URL('./.private/orthanc/https/credentials.json', import.meta.url), 'utf8'));
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
let phase = 'opening frontend';
const diagnostics = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('response', response => {
    if (response.url().endsWith('/api/session')) diagnostics.push(`Session HTTP ${response.status()}`);
  });
  page.on('requestfailed', request => {
    if (request.url().endsWith('/api/session')) diagnostics.push(`Session network error: ${request.failure()?.errorText}`);
  });
  page.on('console', message => {
    if (message.type() === 'error' && /CORS|Content Security Policy|private network|address space/i.test(message.text())) diagnostics.push(message.text());
  });
  let writeAttempted = false;
  await page.route('**/api/review/**', route => { writeAttempted = true; return route.abort(); });
  await page.goto('https://genai-radiology-verify.web.app/');
  await page.locator('#sign-in[open]').waitFor();
  assert.equal(await page.locator('#cases button').count(), 0, 'No metadata before sign-in');
  phase = 'sign-in';
  await page.locator('#review-username').fill(username);
  await page.locator('#review-password').fill(password);
  await page.locator('#sign-in-form').evaluate(form => form.requestSubmit());
  await page.locator('#sign-in[hidden]').waitFor({ state: 'attached' });
  phase = 'image loading';
  await page.locator('#image-message[hidden]').waitFor({ state: 'attached', timeout: 30000 });
  assert.equal(await page.locator('#cases button').count(), 28);
  assert.equal(await page.locator('#rubric .rubric-item').count(), 2);
  assert.equal(await page.locator('#rubric input[type="radio"]').count(), 6);
  assert.equal(await page.locator('#rubric input[type="checkbox"]').count(), 12);
  assert.equal(await page.locator('input[name="description_match"][value="matches"]').count(), 1);
  assert.equal(await page.locator('input[name="clinical_plausibility"][value="plausible"]').count(), 1);
  assert.equal(await page.locator('#rubric input:checked').count(), 0, 'Legacy answers are not prefilled');
  await page.locator('#previous-assessment').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#previous-assessment').getAttribute('open'), '');
  assert.equal(await page.locator('#previous-assessment h3').textContent(), 'Previous assessment');
  assert.equal(await page.locator('#previous-assessment .previous-answer strong').count(), 2);
  await page.locator('#previous-assessment summary').click();
  assert.equal(await page.locator('#previous-assessment .previous-comment').isVisible(), false);
  await page.locator('#previous-assessment summary').click();
  assert.equal(await page.locator('#review-password').inputValue(), '');
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  phase = 'slice navigation';
  await page.locator('#next-slice').click();
  await page.locator('#image-message[hidden]').waitFor({ state: 'attached', timeout: 30000 });
  assert.ok((await page.locator('#slice-number').textContent()).startsWith('2 /'));
  phase = 'whole-stack preload';
  const preloadStarted = Date.now();
  const frames = Number(await page.locator('#slice').getAttribute('max'));
  await page.locator('#load-status').filter({ hasText: `${frames} cached in this tab` }).waitFor({ timeout: 120000 });
  phase = 'continuous cached scrolling';
  let newFrameRequests = 0;
  page.on('request', request => { if (request.url().includes('/api/frame/')) newFrameRequests++; });
  const smooth = await page.evaluate(() => {
    const viewport = document.getElementById('viewport'), results = [];
    for (const direction of [1, -1]) {
      for (let i = 0; i < 20; i++) {
        viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: direction * 100, cancelable: true }));
        const selected = Number(document.getElementById('slice').value);
        results.push(document.getElementById('image-message').hidden && document.getElementById('add-reference').textContent === `Attach slice ${selected}`);
      }
    }
    return results;
  });
  assert.ok(smooth.every(Boolean), 'All 40 wheel steps show the correct cached slice without loading placeholders');
  assert.equal(newFrameRequests, 0, 'Cached scrolling must not fetch frames again');
  assert.equal(writeAttempted, false);
  assert.equal(await journalHash(), before, 'Existing assessments must remain byte-identical');
  console.log(`PASS: deployed Firebase sign-in, real cross-origin image loading, ${frames}-slice preload (${((Date.now() - preloadStarted) / 1000).toFixed(1)}s after initial navigation), 40 continuous cached wheel steps with no loading placeholders or refetches, memory-only credentials; no assessment writes or journal changes.`);
} catch (error) {
  console.error(`Hosted browser verification failed during ${phase} (${error.name}). Private credentials and metadata were not logged.`);
  if (page) {
    const status = await page.locator('#load-status').textContent().catch(() => 'unavailable');
    console.error(`Preload status: ${status}`);
  }
  for (const diagnostic of diagnostics) console.error(diagnostic);
  process.exitCode = 1;
} finally { await browser.close(); }
