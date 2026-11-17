import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';

const here = new URL('./', import.meta.url);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => server.close(resolve));
const sessionFixture = () => ({
  csrf: 'fixture-csrf', rubricVersion: 3, choices: ['yes', 'no'],
  storage: 'firestore', assessmentCollection: 'afrooz-review',
  counts: { targets: 29, matched: 28, unmatched: 1 },
  rubric: [
    { id: 'description_match', text: 'Does this generated scan reflect the description?', definition: 'Fixture definition' },
    { id: 'clinically_accurate', text: 'Is this generated scan clinically accurate?', definition: 'Fixture definition' },
  ],
  cases: Array.from({ length: 28 }, (_, i) => ({
    id: `case-${String(i + 1).padStart(3, '0')}`, title: `Series ${i + 1}`, frames: 2, ordering: 'patient-plane-position',
    prompt: { description: 'Synthetic fixture only', descriptions: [], prompts: [], eventCount: 0, missingPromptEvents: 0 },
  })),
});

for (const storage of ['firestore', 'local']) {
  test(`same-origin ${storage} storage messaging and saves (synthetic only)`, { timeout: 60000 }, async () => {
    const fixture = { ...sessionFixture(), storage, assessmentCollection: storage === 'firestore' ? 'afrooz-review' : null };
    const reviews = new Map();
    const server = createServer(async (req, res) => {
      if (req.url === '/api/session') {
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(fixture)); return;
      }
      if (req.url.startsWith('/api/frame/')) {
        res.setHeader('X-Frame-Metadata', JSON.stringify({ rows: 2, columns: 2, spacing: [1, 1], minimum: 0, maximum: 100, center: 40, width: 400 }));
        res.end(Buffer.from(new Float32Array([0, 30, 60, 100]).buffer)); return;
      }
      if (req.method === 'PUT' && req.url.startsWith('/api/review/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        const review = { ...JSON.parse(body), revision: (reviews.get(req.url)?.revision || 0) + 1 };
        reviews.set(req.url, review);
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(review)); return;
      }
      const name = req.url === '/' ? 'index.html' : req.url.slice(1);
      if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' }[name]);
      res.end(await readFile(new URL(name, here)));
    });
    const origin = await listen(server);
    let browser;
    try {
      const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      browser = await chromium.launch({ headless: true, ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
      const page = await browser.newPage();
      await page.goto(origin);
      await expect(page.locator('#image-message')).toBeHidden();
      await expect(page.getByRole('dialog')).toBeHidden();
      await page.click('#review-info > summary');
      const noAuth = 'There is no authentication: anyone with access to this session can review them. Do not expose this port, use a tunnel, or share the private folder.';
      await expect(page.locator('#privacy-detail')).toContainText(noAuth);
      const destination = storage === 'firestore' ? 'to Firebase Firestore' : 'locally';
      await expect(page.locator('#save-guidance')).toContainText(`autosave ${destination}`);
      if (storage === 'firestore') {
        await expect(page.locator('#privacy-detail')).toContainText('Firebase Firestore (afrooz-review) in project genai-radiology');
        await expect(page.locator('#privacy-detail')).not.toContainText('ratings stay on this computer');
      } else {
        await expect(page.locator('#privacy-detail')).toHaveText(`Images and ratings stay on this computer. ${noAuth}`);
      }
      await page.click('#review-info > summary');
      await page.fill('#comments', 'Synthetic same-origin assessment');
      await expect(page.locator('#save-status')).toContainText(`saved ${destination}`);
      await page.click('[data-case="case-002"]');
      await page.click('[data-case="case-001"]');
      await expect(page.locator('#save-status')).toContainText(`Saved ${destination}`);
      assert.equal(reviews.size, 1);
    } finally {
      await browser?.close();
      await close(server);
    }
  });
}

test('hosting build only includes public assets and separate security config', () => {
  execFileSync(process.execPath, [new URL('build-hosting.mjs', here).pathname]);
});

test('remote sign-in, actual cross-origin preflight, save, auth loss and clear-session', { timeout: 60000 }, async () => {
  assert.deepEqual((await readdir(new URL('.hosting/', here))).sort(), ['app.js', 'index.html', 'style.css']);
  assert.match(await readFile(new URL('.hosting/index.html', here), 'utf8'), /name="review-api-origin" content="https:\/\/orthanc.katelyncmorrison.com"/);
  assert.doesNotMatch(await readFile(new URL('index.html', here), 'utf8'), /name="review-api-origin"/);
  const config = JSON.parse(await readFile(new URL('../firebase.review.json', here), 'utf8')).hosting;
  assert.equal(config.site, 'genai-radiology-verify');
  assert.equal(config.rewrites, undefined);
  const headers = Object.fromEntries(config.headers[0].headers.map(h => [h.key, h.value]));
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.match(headers['Content-Security-Policy'], /form-action 'none'/);
  const expectedAuth = `Basic ${Buffer.from('réviewer:päss🔒').toString('base64')}`;
  const calls = [], writes = [];
  let reject = false, unavailable = false, malformed = false, revision = 0;
  let frontendOrigin;
  const api = createServer(async (req, res) => {
    calls.push({ method: req.method, url: req.url, headers: req.headers });
    res.setHeader('Access-Control-Allow-Origin', frontendOrigin);
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Review-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'X-Frame-Metadata');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    if (unavailable) { req.socket.destroy(); return; }
    if (reject || req.headers.authorization !== expectedAuth) { res.writeHead(401).end(malformed ? '<html>Unauthorized</html>' : JSON.stringify({ error: 'Rejected' })); return; }
    if (req.url === '/api/session') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(sessionFixture())); return; }
    if (req.url.startsWith('/api/frame/')) {
      res.setHeader('X-Frame-Metadata', JSON.stringify({ rows: 2, columns: 2, spacing: [1, 1], minimum: 0, maximum: 100, center: 40, width: 400 }));
      res.end(Buffer.from(new Float32Array([0, 30, 60, 100]).buffer)); return;
    }
    if (req.method === 'PUT') {
      let body = ''; for await (const chunk of req) body += chunk;
      writes.push(JSON.parse(body));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ...writes.at(-1), revision: ++revision })); return;
    }
    res.writeHead(404).end();
  });
  const apiOrigin = await listen(api);
  const frontend = createServer(async (req, res) => {
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return; }
    let text = await readFile(new URL(name, here), 'utf8');
    if (name === 'index.html') text = text.replace('<head>', `<head><meta name="review-api-origin" content="${apiOrigin}">`);
    res.setHeader('Content-Type', { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' }[name]);
    res.setHeader('Content-Security-Policy', headers['Content-Security-Policy'].replace('https://orthanc.katelyncmorrison.com', apiOrigin));
    res.end(text);
  });
  frontendOrigin = await listen(frontend);
  let browser;
  try {
    const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(systemChrome) ? { executablePath: systemChrome } : {}) });
    const page = await browser.newPage();
    const errors = [], fetches = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.exposeFunction('recordFetch', (url, mode, credentials) => fetches.push({ url, mode, credentials }));
    await page.addInitScript(() => {
      const original = window.fetch;
      window.fetch = (url, options) => { window.recordFetch(url, options.mode, options.credentials); return original(url, options); };
    });
    await page.goto(frontendOrigin);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#sign-in-description')).toContainText('assessments stored in Firebase Firestore (afrooz-review)');
    await expect(page.locator('#review-username')).toHaveValue('reviewer');
    assert.equal(calls.length, 0, 'No API request before login');
    const login = async (password = 'päss🔒') => {
      await page.fill('#review-username', 'réviewer'); await page.fill('#review-password', password); await page.click('#sign-in-submit');
    };
    malformed = true; await login('wrong');
    await expect(page.locator('#sign-in-error')).toContainText('Invalid or expired');
    unavailable = true; await login();
    await expect(page.locator('#sign-in-error')).toContainText('Cannot reach');
    unavailable = false; malformed = false;
    await login();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#image-message')).toBeHidden();
    assert.equal(await page.locator('#cases button').count(), 28);
    await expect(page).toHaveTitle('Series review');
    await page.click('#review-info > summary');
    await expect(page.locator('#privacy-detail')).toContainText('Firebase Firestore (afrooz-review) in project genai-radiology');
    await expect(page.locator('#save-guidance')).toContainText('autosave to Firebase Firestore');
    await page.click('#review-info > summary');
    await page.check('input[name="description_match"][value="yes"]');
    await page.fill('#comments', 'Synthetic assessment');
    await expect(page.locator('#save-status')).toContainText('saved to Firebase Firestore');
    const write = calls.find(c => c.method === 'PUT');
    assert.equal(write.headers.authorization, expectedAuth);
    assert.equal(write.headers['x-review-token'], 'fixture-csrf');
    assert.equal(write.headers['content-type'], 'application/json');
    assert.ok(calls.some(c => c.method === 'OPTIONS'));
    assert.ok(calls.filter(c => c.method !== 'OPTIONS').every(c => c.headers.cookie === undefined));
    reject = true; malformed = true;
    await page.fill('#comments', 'Do not discard this answer');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#comments')).toHaveValue('Do not discard this answer');
    const putsAfterLoss = calls.filter(c => c.method === 'PUT').length;
    await login();
    await expect(page.locator('#sign-in-error')).toContainText('Invalid or expired');
    assert.equal(calls.filter(c => c.method === 'PUT').length, putsAfterLoss, 'No repeated failed autosaves');
    reject = false;
    await login();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.locator('#comments')).toHaveValue('Do not discard this answer');
    await expect(page.locator('input[name="description_match"][value="yes"]')).toBeChecked();
    await page.click('#save-draft');
    await expect(page.locator('#save-status')).toContainText('saved to Firebase Firestore');
    assert.equal(writes.at(-1).comments, 'Do not discard this answer');
    assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
    assert.ok(fetches.every(f => f.url.startsWith(apiOrigin + '/api/') && f.mode === 'cors' && f.credentials === 'omit'));
    // Cancel logout with dirty edits, then confirm. No real assessment files exist.
    await page.fill('#comments', 'Unsaved before logout');
    page.once('dialog', dialog => dialog.dismiss());
    await page.click('#logout');
    await expect(page.locator('#comments')).toHaveValue('Unsaved before logout');
    page.once('dialog', dialog => dialog.accept());
    await page.click('#logout');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#review-password')).toHaveValue('');
    await expect(page.locator('#cases button')).toHaveCount(0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await Promise.all([close(frontend), close(api)]);
  }
});
