import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

// Entirely synthetic. Never connect to the live API, DICOMs, or assessment store.
test('preloaded stacks scroll without blanking/refetch; delayed slices stay bounded and cannot display stale images', { timeout: 60000 }, async () => {
  const calls = [], writes = [], errors = [];
  let releaseHeld;
  const held = new Promise(resolve => { releaseHeld = resolve; });
  let active = 0, peak = 0, failSlice = true;
  const server = createServer(async (req, res) => {
    if (req.url === '/api/session') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ csrf: 'synthetic', rubricVersion: 3, choices: ['yes', 'no'], storage: 'local', counts: { targets: 29, matched: 28, unmatched: 1 },
        rubric: [{ id: 'description_match', text: 'Description?', definition: 'Synthetic' }, { id: 'clinically_accurate', text: 'Clinical?', definition: 'Synthetic' }],
        cases: Array.from({ length: 28 }, (_, i) => ({ id: `case-${String(i + 1).padStart(3, '0')}`, title: `Synthetic ${i + 1}`, frames: 24, ordering: 'patient-plane-position', prompt: { description: 'Synthetic', descriptions: [], prompts: [], eventCount: 0, missingPromptEvents: 0 } })),
      })); return;
    }
    if (req.url.startsWith('/api/frame/')) {
      calls.push(req.url); active++; peak = Math.max(peak, active);
      res.once('close', () => { active--; });
      const [, , , caseId, number] = req.url.split('/');
      const index = Number(number);
      if (caseId === 'case-002' && index === 7) await held;
      // Deterministic transfer latency; continuous input must not starve loading.
      await new Promise(resolve => setTimeout(resolve, 12));
      if (res.destroyed) return;
      if (['case-002', 'case-003'].includes(caseId) && index === 20 && failSlice) { res.writeHead(503).end(JSON.stringify({ error: 'Synthetic transfer failure' })); return; }
      res.setHeader('X-Frame-Metadata', JSON.stringify({ rows: 2, columns: 2, spacing: [1, 1], minimum: index, maximum: 100, center: 40, width: 400 }));
      res.end(Buffer.from(new Float32Array([index, index + 10, 60, 100]).buffer)); return;
    }
    if (req.method === 'PUT') { writes.push(req.url); res.writeHead(500).end(); return; }
    const name = req.url === '/' ? 'index.html' : req.url.slice(1);
    if (!['index.html', 'app.js', 'style.css'].includes(name)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', { 'index.html': 'text/html', 'app.js': 'text/javascript', 'style.css': 'text/css' }[name]);
    res.end(await readFile(new URL(name, import.meta.url)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    browser = await chromium.launch({ headless: true, ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
    const page = await browser.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await expect(page.locator('#load-status')).toContainText('24 cached in this tab');
    assert.equal(calls.length, 24, 'Idle time preloads every slice exactly once');
    const before = calls.length;
    const displayed = await page.evaluate(() => {
      const samples = [], viewport = document.getElementById('viewport');
      for (let i = 0; i < 20; i++) {
        viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
        samples.push({ messageHidden: document.getElementById('image-message').hidden, attachment: document.getElementById('add-reference').textContent });
      }
      for (let i = 0; i < 20; i++) viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
      return samples;
    });
    assert.ok(displayed.every((sample, i) => sample.messageHidden && sample.attachment === `Attach slice ${i + 2}`), 'Every cached wheel step renders synchronously with the correct attachment label');
    await expect(page.locator('#add-reference')).toHaveText('Attach slice 1');
    assert.equal(calls.length, before, 'Forward/backward scrolling never refetches cached pixels');
    const select = number => page.locator('#slice').evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input')); }, number);
    await page.click('[data-case="case-002"]');
    await expect.poll(() => calls.includes('/api/frame/case-002/7')).toBe(true);
    await select(8);
    await expect(page.locator('#add-reference')).toBeDisabled();
    await expect(page.locator('#image-message')).toContainText('Loading slice 8');
    await select(10);
    await expect(page.locator('#add-reference')).toHaveText('Attach slice 10');
    await expect(page.locator('#image-message')).toBeHidden();
    releaseHeld();
    await expect(page.locator('#load-status')).toContainText('1 load errors');
    await expect(page.locator('#add-reference')).toHaveText('Attach slice 10');
    await select(21);
    await expect(page.locator('#image-message')).toContainText('IMAGE LOAD FAILED');
    await expect(page.locator('#finalize')).toBeDisabled();
    failSlice = false;
    await page.click('#retry-image');
    await expect(page.locator('#image-message')).toBeHidden();
    await expect(page.locator('#retry-image')).toBeHidden();
    await expect(page.locator('#load-status')).toContainText('24 cached in this tab');
    failSlice = true;
    await page.click('[data-case="case-003"]');
    await expect(page.locator('#confirm-text')).toContainText('Image failure on slice 21');
    await expect(page.locator('#add-reference')).toHaveText('Attach slice 1');
    failSlice = false;
    await page.click('#retry-image');
    await expect(page.locator('#retry-image')).toBeHidden();
    await expect(page.locator('#load-status')).toContainText('24 cached in this tab');
    await expect(page.locator('#add-reference')).toHaveText('Attach slice 1');
    assert.ok(peak <= 2, `At most two concurrent transfers, observed ${peak}`);
    assert.deepEqual(writes, [], 'Image preload/navigation does not save assessments');
    assert.deepEqual(errors, []);
  } finally {
    releaseHeld();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
