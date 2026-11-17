/* Canvas viewer. No CDN, telemetry, or browser storage. */
const $ = id => document.getElementById(id);
const apiOrigin = document.querySelector('meta[name="review-api-origin"]')?.content.trim().replace(/\/$/, '') || '';
const remote = !!apiOrigin;
let authorization = '', authAttempt = false;
const labels = { yes: 'Yes', no: 'No' };
let session, current, dirty = false, changeNumber = 0, saveTimer, saving = null, switching = false;
let sliceIndex = 0, displayedIndex = null, image = null, epoch = 0, frameTimer;
let windowCenter = 0, windowWidth = 1, zoom = 1, panX = 0, panY = 0, drag;
const views = new Map(), progress = new Map(), cache = new Map();
// RAM only. Enough for this cohort's 256-slice stacks, bounded for larger images.
const CACHE_LIMIT = 128 * 1024 * 1024, frameJobs = new Map(), prefetchFailures = new Set();
let cacheBytes = 0, activeFrames = 0;
const canvas = $('image'), context = canvas.getContext('2d');
const offscreen = document.createElement('canvas'), offContext = offscreen.getContext('2d');
const localPrivacy = $('privacy-detail').textContent, saveGuidance = $('save-guidance').textContent;
function saveDestination() { return session.storage === 'firestore' ? 'to Firebase Firestore' : 'locally'; }
function storageMessaging() {
  const firestore = session.storage === 'firestore';
  const storage = firestore ? `Assessments are stored in Firebase Firestore (${session.assessmentCollection}) in project genai-radiology.` : 'Assessments are saved locally on the review server.';
  $('privacy-detail').textContent = remote
    ? `Images are transmitted over HTTPS from the researcher Mac; ${storage.charAt(0).toLowerCase()}${storage.slice(1)} Credentials stay in memory for this tab only.`
    : firestore ? localPrivacy.replace('Images and ratings stay on this computer.', `Images stay on this computer. ${storage}`) : localPrivacy;
  $('save-guidance').textContent = saveGuidance.replace('autosave locally', `autosave ${saveDestination()}`);
}
function showError(error) { $('save-error').hidden = false; $('save-error').textContent = error.message; }
async function request(url, options = {}) {
  if (remote && !authorization) throw new Error('Sign in again to continue. Unsaved answers are retained.');
  const sentAuthorization = authorization;
  const headers = new Headers(options.headers);
  if (remote) headers.set('Authorization', sentAuthorization);
  let response;
  try {
    response = await fetch(remote ? `${apiOrigin}${url}` : url, { cache: 'no-store', ...options, headers, ...(remote ? { mode: 'cors', credentials: 'omit' } : {}) });
  } catch (error) {
    if (!remote || error.name === 'AbortError') throw error;
    throw new Error('Cannot reach the review server. Check your connection or server availability (including HTTPS/CORS), then retry. Unsaved answers are retained.');
  }
  if (!response.ok) {
    if (remote && response.status === 401 && authorization === sentAuthorization) {
      authorization = ''; clearTimeout(saveTimer);
      openSignIn('Sign-in expired or credentials were rejected. Sign in again; unsaved answers are retained.');
    }
    let data;
    try { data = await response.json(); } catch { /* Proxy errors may not be JSON. */ }
    throw new Error(response.status === 401 && remote ? 'Invalid or expired credentials. Sign in again; unsaved answers are retained.' : data?.error || (remote ? `Review server request failed (${response.status}). Please retry.` : 'Local request failed'));
  }
  return response;
}
function openSignIn(message = '') {
  $('sign-in').hidden = false;
  $('sign-in-error').textContent = message;
  $('sign-in-error').hidden = !message;
  if (!$('sign-in').open) $('sign-in').showModal();
}
function clearSession() {
  if ((dirty || saving) && !window.confirm('Unsaved edits or an in-progress save may be lost. Clear this session and sign out?')) return;
  authorization = ''; $('review-password').value = '';
  clearTimeout(saveTimer); clearTimeout(frameTimer); cancelFrames();
  cache.clear(); views.clear(); progress.clear(); image = null;
  offscreen.width = offscreen.height = 0; canvas.width = canvas.height = 0;
  dirty = false; saving = null;
  window.location.reload();
}
function completion() {
  const finals = session.cases.filter(c => c.review?.rubricVersion === session.rubricVersion && c.review?.status === 'final').length;
  const drafts = session.cases.filter(c => c.review?.rubricVersion === session.rubricVersion && c.review?.status === 'draft').length;
  const legacy = session.cases.filter(c => c.review?.status === 'legacy').length;
  $('completion').textContent = `${finals} / ${session.cases.length} final · ${drafts} drafts · ${legacy} previous rubric · ${session.cases.length - finals - drafts - legacy} not started`;
  for (const c of session.cases) {
    const button = document.querySelector(`[data-case="${c.id}"]`);
    button.setAttribute('aria-current', String(c === current));
    button.dataset.status = c.review?.status || 'not-started';
    button.querySelector('small').textContent = c.review?.status === 'legacy' ? `v${c.review.rubricVersion} ${c.review.previousAssessment?.status || 'saved'} · needs v${session.rubricVersion}` : c.review?.status || '—';
  }
}
function answers() {
  return Object.fromEntries(session.rubric.flatMap(r => {
    const value = document.querySelector(`input[name="${r.id}"]:checked`)?.value;
    return value ? [[r.id, value]] : [];
  }));
}
function references() { return [...$('references').querySelectorAll('button')].map(b => Number(b.dataset.slice)); }
function issueValues() {
  return Object.fromEntries(session.rubric.filter(r => r.issueField).map(r => [r.issueField,
    r.issueWhen.includes(answers()[r.id]) ? [...document.querySelectorAll(`input[name="${r.issueField}"]:checked`)].map(input => input.value) : [],
  ]));
}
function syncIssues() {
  for (const r of session.rubric.filter(r => r.issueField)) {
    const group = $(`issues-${r.id}`), visible = r.issueWhen.includes(answers()[r.id]);
    group.hidden = !visible;
    group.querySelectorAll('input').forEach(input => { input.disabled = !visible; if (!visible) input.checked = false; });
  }
}
function renderPrevious() {
  const previous = current.review?.previousAssessment, panel = $('previous-assessment');
  panel.replaceChildren(); panel.hidden = !previous;
  if (!previous) return;
  const summary = document.createElement('summary');
  const heading = document.createElement('h3'); heading.textContent = 'Previous assessment'; summary.append(heading); panel.append(summary);
  const info = document.createElement('p'); info.textContent = `Rubric v${previous.rubricVersion} · ${previous.status} · revision ${previous.revision} · saved ${previous.savedAt || 'time unavailable'}.`; panel.append(info);
  for (const [key, value] of Object.entries(previous.answers || {})) {
    const line = document.createElement('p'); line.className = 'previous-answer';
    const title = key === 'description_match' ? 'Description match' : key === 'clinically_accurate' ? 'Clinical accuracy (previous wording)' : key;
    const category = document.createElement('span'); category.textContent = `${title}: `;
    const answer = document.createElement('strong'); answer.textContent = labels[value] || value;
    line.append(category, answer); panel.append(line);
  }
  const comment = document.createElement('p'); comment.className = 'previous-comment'; comment.textContent = previous.comments || 'No previous comment recorded.'; panel.append(comment);
  const refs = document.createElement('p'); refs.textContent = `Previous slice references: ${(previous.references || []).join(', ') || 'None'}`; panel.append(refs);
}
function addReference(number) {
  if (references().includes(number)) return;
  const button = document.createElement('button');
  button.type = 'button'; button.dataset.slice = number; button.textContent = `Slice ${number} ×`;
  button.setAttribute('aria-label', `Remove slice ${number} reference`);
  button.title = 'Remove attachment only; comment text stays as standalone text.';
  button.onclick = () => { button.remove(); $('reference-group').hidden = !references().length; edited(); };
  $('references').append(button);
  $('reference-group').hidden = false;
}
function attachSlice() {
  if (!image || displayedIndex === null) return;
  const number = displayedIndex + 1, comments = $('comments');
  // A repeated attachment reuses its readable marker, including after a tag was removed.
  const existing = new RegExp(`(^|\\s)Slice ${number}:(?=\\s|$)`).exec(comments.value);
  let caret;
  if (existing) {
    caret = existing.index + existing[0].length;
    if (comments.value[caret] === ' ') caret++;
  } else {
    const start = comments.selectionStart;
    const prefix = start && !/\s/.test(comments.value[start - 1]) ? (start === comments.value.length ? '\n' : ' ') : '';
    const marker = `${prefix}Slice ${number}: `;
    // Never replace selected prose or exceed the comment limit.
    if (comments.value.length + marker.length > comments.maxLength) { comments.focus(); return; }
    comments.setRangeText(marker, start, start, 'end');
    caret = start + marker.length;
  }
  addReference(number);
  comments.focus(); comments.setSelectionRange(caret, caret);
  edited();
}
function commentRequired() {
  const a = answers();
  return session.rubricVersion >= 4 ? a.description_match !== 'matches' || a.clinical_plausibility !== 'plausible' : a.description_match !== 'yes' || a.clinically_accurate !== 'yes';
}
function hasComment() { return !!$('comments').value.replace(/\bSlice\s+\d+\s*:/gi, '').trim(); }
function canFinalize() {
  if (!current) return false;
  const a = answers();
  return session.rubric.every(r => a[r.id]) && (!commentRequired() || hasComment()) && !!image && progress.get(current.id).loaded.size > 0 && progress.get(current.id).failures.size === 0;
}
function reviewUI() {
  syncIssues();
  $('comments').required = commentRequired();
  $('comments').setAttribute('aria-required', String(commentRequired()));
  $('comment-status').textContent = '';
  $('add-reference').disabled = !image || displayedIndex === null;
  $('add-reference').textContent = displayedIndex === null ? 'Attach slice' : `Attach slice ${displayedIndex + 1}`;
  $('finalize').disabled = !!saving || !canFinalize();
  $('case-status').textContent = dirty ? 'Unsaved draft' : current.review?.status === 'final' ? 'Final · editable' : current.review?.status === 'draft' ? 'Draft' : current.review?.status === 'legacy' ? `Needs v${session.rubricVersion} assessment` : 'Not started';
}
function edited() {
  dirty = true; changeNumber++;
  $('save-status').textContent = 'Unsaved draft'; $('save-error').hidden = true;
  clearTimeout(saveTimer); if (!remote || authorization) saveTimer = setTimeout(() => save('draft').catch(showError), 650);
  reviewUI();
}
async function save(status) {
  clearTimeout(saveTimer);
  if (remote && !authorization) { openSignIn('Sign in to save. Unsaved answers are retained.'); throw new Error('Sign in to save. Unsaved answers are retained.'); }
  if (saving) { await saving; if (status === 'draft' && !dirty) return; }
  if (status === 'draft' && !dirty) return;
  const c = current, version = changeNumber;
  const body = { expectedRevision: c.review?.revision || 0, rubricVersion: session.rubricVersion, status, answers: answers(), ...issueValues(), comments: $('comments').value, references: references(), confirmed: status === 'final' };
  $('save-status').textContent = `Saving ${saveDestination()}…`;
  saving = (async () => {
    const response = await request(`/api/review/${c.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Review-Token': session.csrf }, body: JSON.stringify(body) });
    c.review = await response.json();
    renderPrevious();
    if (version === changeNumber) dirty = false;
    $('save-status').textContent = dirty ? 'New edits pending…' : `${status === 'final' ? 'Final review' : 'Draft'} saved ${saveDestination()} · revision ${c.review.revision}`;
    $('save-error').hidden = true;
    completion();
  })();
  reviewUI();
  try { await saving; } finally { saving = null; reviewUI(); }
  if (dirty) { clearTimeout(saveTimer); saveTimer = setTimeout(() => save('draft').catch(showError), 650); }
}
function defaults() {
  if (!image) return;
  const m = image.metadata;
  const preset = $('preset').value;
  const presets = { soft: [40, 400], lung: [-600, 1500], liver: [90, 150], bone: [480, 2500], brain: [40, 80] };
  [windowCenter, windowWidth] = presets[preset] || (preset === 'auto' ? [(m.minimum + m.maximum) / 2, Math.max(1, m.maximum - m.minimum)] : [m.center, m.width]);
}
function drawPixels() {
  if (!image) return draw();
  const { rows, columns, invert } = image.metadata;
  offscreen.width = columns; offscreen.height = rows;
  const out = offContext.createImageData(columns, rows);
  const width = Math.max(1, windowWidth);
  for (let i = 0; i < image.pixels.length; i++) {
    const normalized = width <= 1 ? (image.pixels[i] > windowCenter - .5 ? 255 : 0) : ((image.pixels[i] - (windowCenter - .5)) / (width - 1) + .5) * 255;
    const value = Math.max(0, Math.min(255, normalized));
    const shade = invert ? 255 - value : value;
    out.data[i * 4] = out.data[i * 4 + 1] = out.data[i * 4 + 2] = shade; out.data[i * 4 + 3] = 255;
  }
  offContext.putImageData(out, 0, 0); draw();
}
function draw() {
  const rect = canvas.getBoundingClientRect(), ratio = devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * ratio); canvas.height = Math.round(rect.height * ratio);
  context.fillStyle = '#000'; context.fillRect(0, 0, canvas.width, canvas.height);
  if (!image) { $('image-overlay').textContent = ''; return; }
  const m = image.metadata;
  const aspect = m.spacing[0] / m.spacing[1];
  const fit = Math.min(rect.width / m.columns, rect.height / (m.rows * aspect));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.translate(rect.width / 2 + panX, rect.height / 2 + panY);
  context.scale(fit * zoom, fit * zoom * aspect);
  context.imageSmoothingEnabled = true;
  context.drawImage(offscreen, -m.columns / 2, -m.rows / 2);
  $('image-overlay').textContent = `W ${windowWidth.toFixed(0)}  L ${windowCenter.toFixed(0)} · ${(zoom * 100).toFixed(0)}% · ${m.columns} × ${m.rows}`;
}
function loadStatus() {
  const p = progress.get(current.id);
  const cached = [...cache.keys()].filter(key => key.startsWith(`${current.id}:`)).length;
  $('load-status').textContent = `${p.loaded.size} / ${current.frames} slices loaded · ${cached} cached in this tab · ${p.errors.size} load errors · ${p.loaded.size < current.frames ? 'Preloading nearby slices' : 'All loaded'}; inspection not verified${current.ordering !== 'patient-plane-position' ? ' · instance-number order; geometry unavailable' : ''}`;
  const failedSlices = [...p.failures].sort((a, b) => a - b).map(index => index + 1);
  $('confirm-text').textContent = p.failures.size ? `Image failure on slice${p.failures.size > 1 ? 's' : ''} ${failedSlices.slice(0, 8).join(', ')}${p.failures.size > 8 ? ', …' : ''} — finalization blocked. Retry failed slices or save a draft and skip.` : 'Finalize only with sufficient visual evidence; otherwise save a draft and skip.';
  $('confirm-text').dataset.blocked = String(p.failures.size > 0);
  $('retry-image').hidden = p.failures.size === 0;
  $('retry-image').textContent = 'Retry failed slices';
  reviewUI();
}
function cancelFrames() {
  for (const [key, job] of frameJobs) {
    job.controller.abort();
    frameJobs.delete(key);
    if (!job.started) job.reject(new DOMException('Frame superseded', 'AbortError'));
  }
}
function rememberFrame(key, value) {
  if (cache.has(key)) cacheBytes -= cache.get(key).pixels.byteLength;
  cache.delete(key); cache.set(key, value); cacheBytes += value.pixels.byteLength;
  while (cacheBytes > CACHE_LIMIT && cache.size > 1) {
    // Keep the selected slice and its nearest neighbors, not a recently prefetched distant slice.
    const victim = [...cache.keys()].filter(item => item !== key && item !== `${current.id}:${sliceIndex}`)
      .sort((a, b) => Math.abs(Number(b.split(':')[1]) - sliceIndex) - Math.abs(Number(a.split(':')[1]) - sliceIndex))[0];
    if (!victim) break;
    cacheBytes -= cache.get(victim).pixels.byteLength; cache.delete(victim);
  }
}
function pumpFrames() {
  while (activeFrames < 2) {
    const job = [...frameJobs.values()].filter(item => !item.started)
      .sort((a, b) => Number(a.background) - Number(b.background))[0];
    if (!job) break;
    job.started = true; activeFrames++;
    (async () => {
      const timeout = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, 30000);
      try {
        const response = await request(`/api/frame/${job.c.id}/${job.index}`, { signal: job.controller.signal });
        const metadata = JSON.parse(response.headers.get('X-Frame-Metadata'));
        const buffer = await response.arrayBuffer();
        if (!metadata || !Number.isSafeInteger(metadata.rows) || !Number.isSafeInteger(metadata.columns) || metadata.rows <= 0 || metadata.columns <= 0 || buffer.byteLength !== metadata.rows * metadata.columns * 4) throw new Error('Incomplete pixel data');
        if (job.controller.signal.aborted || job.c !== current) throw new DOMException('Frame superseded', 'AbortError');
        const value = { metadata, pixels: new Float32Array(buffer) };
        rememberFrame(job.key, value);
        const p = progress.get(job.c.id);
        p.loaded.add(job.index); p.failures.delete(job.index); prefetchFailures.delete(job.key);
        job.resolve(value);
      } catch (error) {
        if (job.timedOut) error = new Error('Slice transfer timed out. Retry this slice.');
        if (error.name !== 'AbortError' && job.c === current) {
          prefetchFailures.add(job.key);
          const p = progress.get(job.c.id); p.errors.add(job.index); p.failures.add(job.index);
        }
        job.reject(error);
      } finally {
        clearTimeout(timeout);
        // A canceled old-case job must not delete a newer request with the same key.
        if (frameJobs.get(job.key) === job) frameJobs.delete(job.key);
        activeFrames--;
        if (current) loadStatus();
        pumpFrames(); prefetchFrames();
      }
    })();
  }
}
function fetchFrame(c, index, background = false) {
  const key = `${c.id}:${index}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key));
  const existing = frameJobs.get(key);
  if (existing) { if (!background) existing.background = false; return existing.promise; }
  const job = { key, c, index, background, started: false, controller: new AbortController() };
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  frameJobs.set(key, job); pumpFrames();
  return job.promise;
}
function prefetchFrames() {
  if (!current || (remote && !authorization) || !cache.size) return;
  const frameBytes = image?.pixels.byteLength || cache.values().next().value.pixels.byteLength;
  // Don't cycle through an oversized stack, continually evicting and downloading it again.
  const capacity = Math.max(1, Math.floor(CACHE_LIMIT / frameBytes));
  for (let distance = 0; distance < current.frames && frameJobs.size < 2; distance++) {
    for (const index of distance ? [sliceIndex + distance, sliceIndex - distance] : [sliceIndex]) {
      if (index < 0 || index >= current.frames || Math.abs(index - sliceIndex) > Math.floor((capacity - 1) / 2) && current.frames > capacity) continue;
      const key = `${current.id}:${index}`;
      if (!cache.has(key) && !frameJobs.has(key) && !prefetchFailures.has(key) && frameJobs.size < 2) fetchFrame(current, index, true).catch(() => {});
    }
  }
}
async function loadFrame() {
  const token = ++epoch, c = current, index = sliceIndex, key = `${c.id}:${index}`;
  // Remove superseded queued work. In-flight requests finish into the cache instead
  // of repeatedly aborting/re-decoding slices during a continuous wheel gesture.
  for (const [otherKey, job] of frameJobs) {
    if (!job.started && otherKey !== key) { frameJobs.delete(otherKey); job.reject(new DOMException('Frame superseded', 'AbortError')); }
  }
  try {
    const value = cache.get(key) || await fetchFrame(c, index);
    if (token !== epoch || c !== current || index !== sliceIndex) return;
    progress.get(c.id).loaded.add(index);
    progress.get(c.id).failures.delete(index);
    image = value; displayedIndex = index;
    if (!views.get(c.id)?.windowed) { defaults(); views.set(c.id, { ...views.get(c.id), windowed: true }); }
    $('image-message').hidden = true; $('add-reference').disabled = false;
    drawPixels(); loadStatus(); prefetchFrames();
  } catch (error) {
    if (error.name === 'AbortError' || token !== epoch || c !== current || index !== sliceIndex) return;
    progress.get(c.id).errors.add(index);
    progress.get(c.id).failures.add(index);
    $('image-message').textContent = `IMAGE LOAD FAILED — ${error.message} Do not guess Yes or No. Retry this slice, or save a draft and skip this case.`;
    loadStatus();
  }
}
function setSlice(index, immediate = false) {
  const next = Math.max(0, Math.min(current.frames - 1, index));
  if (next === sliceIndex && image) return;
  sliceIndex = next; $('slice').value = next + 1; $('slice-number').textContent = `${next + 1} / ${current.frames}`;
  // Cache hits render synchronously: no blank canvas or artificial 75ms wait.
  epoch++;
  if (cache.has(`${current.id}:${next}`)) { clearTimeout(frameTimer); frameTimer = null; loadFrame(); return; }
  // A previous image must never appear for a new slice label or be attachable.
  image = null; displayedIndex = null; $('add-reference').disabled = true; draw();
  reviewUI();
  $('image-message').hidden = false; $('image-message').textContent = `Loading slice ${next + 1}…`;
  // Throttle, don't debounce: continued input must not postpone loading forever.
  if (immediate) { clearTimeout(frameTimer); frameTimer = null; loadFrame(); }
  else if (!frameTimer) frameTimer = setTimeout(() => { frameTimer = null; loadFrame(); }, 32);
}
async function selectCase(c) {
  if (switching || c === current) return;
  switching = true;
  try {
    if (current) {
      if (saving) await saving;
      while (dirty) await save('draft');
      views.set(current.id, { sliceIndex, windowCenter, windowWidth, zoom, panX, panY, preset: $('preset').value, windowed: !!image });
    }
    clearTimeout(saveTimer); clearTimeout(frameTimer); frameTimer = null; epoch++; cancelFrames();
    cache.clear(); cacheBytes = 0; prefetchFailures.clear(); image = null; displayedIndex = null;
    current = c; dirty = false; changeNumber = 0;
    const v = views.get(c.id);
    sliceIndex = v?.sliceIndex || 0; zoom = v?.zoom || 1; panX = v?.panX || 0; panY = v?.panY || 0;
    windowCenter = v?.windowCenter || 0; windowWidth = v?.windowWidth || 1; setPreset(v?.preset || 'dicom');
    $('case-title').textContent = c.title;
    renderPrompt(c.prompt);
    $('slice').max = c.frames; $('slice').value = sliceIndex + 1; $('slice-number').textContent = `${sliceIndex + 1} / ${c.frames}`;
    document.querySelectorAll('#rubric input').forEach(input => { input.checked = input.type === 'checkbox' ? (c.review?.[input.name] || []).includes(input.value) : c.review?.answers[input.name] === input.value; });
    renderPrevious(); syncIssues();
    $('comments').value = c.review?.comments || ''; $('references').replaceChildren(); $('reference-group').hidden = true;
    for (const ref of c.review?.references || []) addReference(ref);
    $('save-status').textContent = c.review && c.review.status !== 'legacy' ? `Saved ${saveDestination()} · revision ${c.review.revision}` : '';
    $('save-error').hidden = true;
    completion(); loadStatus();
    $('image-message').hidden = false; $('image-message').textContent = `Loading slice ${sliceIndex + 1}…`;
    await loadFrame();
  } catch (error) { showError(error); } finally { switching = false; }
}
function changeZoom(factor) { zoom = Math.max(.1, Math.min(12, zoom * factor)); draw(); }
// The native select remains the state source for integrations/selectOption.
// Internal assignments use setPreset because assigning value emits no change event.
const presetSelect = $('preset'), presetButton = $('preset-button'), presetList = $('preset-listbox');
const presetOptions = [...presetSelect.options].map((option, index) => {
  const [label, shortcut] = option.textContent.split(' · ');
  const item = document.createElement('li');
  item.id = `preset-option-${option.value}`; item.className = 'preset-option';
  item.setAttribute('role', 'option'); item.dataset.value = option.value;
  const text = document.createElement('span'); text.textContent = label; item.append(text);
  if (shortcut) {
    const badge = document.createElement('span'); badge.className = 'preset-shortcut';
    badge.textContent = shortcut; badge.setAttribute('aria-hidden', 'true'); item.append(badge);
    item.setAttribute('aria-keyshortcuts', shortcut);
  }
  item.onclick = () => { setPreset(option.value); defaults(); drawPixels(); closePresets(true); };
  item.onpointermove = () => activatePreset(index, false);
  presetList.append(item);
  return { value: option.value, label, shortcut, item };
});
let activePreset = 0;
function syncPreset() {
  const selected = presetOptions.find(option => option.value === presetSelect.value);
  $('preset-current').textContent = selected?.label || 'Choose preset';
  $('preset-shortcut').textContent = selected?.shortcut || '';
  $('preset-shortcut').hidden = !selected?.shortcut;
  for (const option of presetOptions) option.item.setAttribute('aria-selected', String(option === selected));
  if (!presetList.hidden) activatePreset(Math.max(0, presetOptions.indexOf(selected)));
}
function setPreset(value) { presetSelect.value = value; syncPreset(); }
function positionPresets() {
  if (presetList.hidden) return;
  const rect = presetButton.getBoundingClientRect(), viewport = window.visualViewport;
  const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
  const width = viewport?.width || document.documentElement.clientWidth;
  const height = viewport?.height || document.documentElement.clientHeight;
  const margin = 8, gap = 4, below = top + height - rect.bottom - margin - gap;
  const above = rect.top - top - margin - gap;
  const naturalHeight = presetList.scrollHeight + 2;
  const openAbove = below < naturalHeight && above > below;
  presetList.style.width = `${Math.min(Math.max(rect.width, 180), width - margin * 2)}px`;
  presetList.style.maxHeight = `${Math.max(0, openAbove ? above : below)}px`;
  const menu = presetList.getBoundingClientRect();
  presetList.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - menu.width - margin))}px`;
  presetList.style.top = `${Math.max(top + margin, openAbove ? rect.top - gap - menu.height : Math.min(rect.bottom + gap, top + height - menu.height - margin))}px`;
}
function activatePreset(index, scroll = true) {
  activePreset = Math.max(0, Math.min(presetOptions.length - 1, index));
  presetOptions.forEach((option, i) => { option.item.dataset.active = String(i === activePreset); });
  presetList.setAttribute('aria-activedescendant', presetOptions[activePreset].item.id);
  if (scroll) presetOptions[activePreset].item.scrollIntoView({ block: 'nearest' });
}
function openPresets(index = presetSelect.selectedIndex) {
  presetList.hidden = false; presetButton.setAttribute('aria-expanded', 'true');
  positionPresets(); activatePreset(index); presetList.focus({ preventScroll: true });
}
function closePresets(restoreFocus = false) {
  presetList.hidden = true; presetButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) presetButton.focus({ preventScroll: true });
}
presetButton.onclick = () => presetList.hidden ? openPresets() : closePresets(true);
presetButton.onkeydown = event => {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  openPresets(event.key === 'Home' ? 0 : event.key === 'End' ? presetOptions.length - 1 : presetSelect.selectedIndex);
};
presetList.onkeydown = event => {
  if (event.key === 'Tab') { closePresets(true); return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  if (event.key === 'Escape') closePresets(true);
  else if (event.key === 'Enter' || event.key === ' ') presetOptions[activePreset].item.click();
  else activatePreset(event.key === 'Home' ? 0 : event.key === 'End' ? presetOptions.length - 1 : activePreset + (event.key === 'ArrowDown' ? 1 : -1));
};
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('.preset-control')) closePresets();
});
document.addEventListener('focusin', event => {
  if (!event.target.closest('.preset-control')) closePresets();
});
window.addEventListener('resize', positionPresets);
document.addEventListener('scroll', positionPresets, true);
window.visualViewport?.addEventListener('resize', positionPresets);
window.visualViewport?.addEventListener('scroll', positionPresets);
syncPreset();
function syncTool() {
  document.querySelectorAll('button[data-tool]').forEach(button => {
    button.setAttribute('aria-pressed', String(button.dataset.tool === $('tool').value));
  });
  $('viewport').dataset.tool = $('tool').value;
}
document.querySelectorAll('button[data-tool]').forEach(button => {
  button.onclick = () => { $('tool').value = button.dataset.tool; syncTool(); };
});
$('tool').onchange = syncTool;
syncTool();
function renderPrompt(p) {
  $('generation-description').textContent = p.description || (p.descriptions.length > 1 ? 'Multiple DICOM descriptions; no single generation description verified. See provenance details.' : 'Generation prompt unavailable. Do not infer an original prompt from the scan.');
  $('prompt-provenance').textContent = 'DICOM description · generation prompt not verified.';
  $('prompt-summary').textContent = `Logged inputs (${p.prompts.length}) & provenance`;
  $('prompt-detail').open = false;
  const list = $('logged-prompts'); list.replaceChildren();
  for (const prompt of p.prompts) {
    const item = document.createElement('li'); item.textContent = `${prompt.text} (${prompt.eventCount} logged event${prompt.eventCount === 1 ? '' : 's'})`; list.append(item);
  }
  for (const description of p.descriptions.length > 1 ? p.descriptions : []) {
    const item = document.createElement('li'); item.textContent = `DICOM description: ${description}`; list.append(item);
  }
  $('prompt-count').textContent = `${p.eventCount} variations_log events matched by exact study + series within strict schedule windows. ${p.missingPromptEvents} events lack prompt text. ${p.prompts.length > 1 ? 'All distinct inputs are listed; none was selected arbitrarily.' : ''}`;
}
$('slice').oninput = () => setSlice(Number($('slice').value) - 1);
$('previous-slice').onclick = () => setSlice(sliceIndex - 1);
$('next-slice').onclick = () => setSlice(sliceIndex + 1);
$('preset').onchange = () => { syncPreset(); defaults(); drawPixels(); };
$('reset').onclick = () => { zoom = 1; panX = panY = 0; setPreset('dicom'); defaults(); drawPixels(); };
$('zoom-in').onclick = () => changeZoom(1.2); $('zoom-out').onclick = () => changeZoom(1 / 1.2);
$('viewport').addEventListener('wheel', event => { event.preventDefault(); if (current) setSlice(sliceIndex + Math.sign(event.deltaY)); }, { passive: false });
$('viewport').onkeydown = event => {
  if (!current) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const presetKey = { '1': 'soft', '2': 'lung', '3': 'liver', '4': 'bone', '5': 'brain' }[event.key];
  if (presetKey) {
    event.preventDefault();
    setPreset(presetKey);
    $('preset').dispatchEvent(new Event('change'));
    return;
  }
  const toolKey = { w: 'window', p: 'pan', z: 'zoom' }[event.key.toLowerCase()];
  if (!event.ctrlKey && !event.metaKey && !event.altKey && (toolKey || event.key.toLowerCase() === 'r')) {
    event.preventDefault();
    if (toolKey) { $('tool').value = toolKey; syncTool(); } else $('reset').click();
    return;
  }
  if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', '+', '-', '='].includes(event.key)) event.preventDefault();
  if (['ArrowLeft', 'ArrowUp'].includes(event.key)) setSlice(sliceIndex - 1);
  if (['ArrowRight', 'ArrowDown'].includes(event.key)) setSlice(sliceIndex + 1);
  if (['+', '='].includes(event.key)) changeZoom(1.2); if (event.key === '-') changeZoom(1 / 1.2);
};
canvas.onpointerdown = event => { if (!image) return; canvas.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY, center: windowCenter, width: windowWidth, zoom, panX, panY }; };
canvas.onpointermove = event => {
  if (!drag || !image) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if ($('tool').value === 'window') { windowCenter = drag.center + dy * Math.max(1, drag.width / 300); windowWidth = Math.max(1, drag.width + dx * Math.max(1, drag.width / 300)); drawPixels(); }
  else if ($('tool').value === 'pan') { panX = drag.panX + dx; panY = drag.panY + dy; draw(); }
  else { zoom = Math.max(.1, Math.min(12, drag.zoom * Math.exp(-dy / 160))); draw(); }
};
canvas.onpointerup = canvas.onpointercancel = () => { drag = null; };
$('comments').oninput = edited;
$('rubric').onchange = edited;
$('retry-image').onclick = async () => {
  const c = current, failures = [...progress.get(c.id).failures];
  // Preloading can discover an unavailable slice other than the displayed one.
  // Retry those actual failures, not just the (possibly cached) current image.
  $('retry-image').disabled = true;
  try {
    for (const index of failures) {
      if (c !== current || (remote && !authorization)) break;
      try { await fetchFrame(c, index); } catch { /* Failure stays explicit until a successful retry. */ }
    }
    if (c === current) await loadFrame();
  } finally { $('retry-image').disabled = false; }
};
$('add-reference').onclick = attachSlice;
$('save-draft').onclick = () => save('draft').catch(showError);
$('review-form').onsubmit = event => { event.preventDefault(); if (canFinalize()) save('final').catch(showError); };
$('previous-case').onclick = () => selectCase(session.cases[Math.max(0, session.cases.indexOf(current) - 1)]);
$('next-case').onclick = () => selectCase(session.cases[Math.min(27, session.cases.indexOf(current) + 1)]);
window.addEventListener('beforeunload', event => { if (dirty || saving) { event.preventDefault(); event.returnValue = ''; } });
new ResizeObserver(draw).observe($('viewport'));
async function initialize(initialSession) {
  try {
    session = initialSession || await (await request('/api/session')).json();
    storageMessaging();
    $('definition-detail').textContent = 'Answer the two questions independently. Optional issue tags mean reported concerns; unselected tags do not establish normality. Neither assessment certifies diagnostic use or fidelity to a real patient.';
    $('cohort-detail').textContent = `Frozen cohort, single reviewer: ${session.counts.targets} targets · ${session.counts.matched} ${remote ? 'matched series' : 'local matches'} · ${session.counts.unmatched} unmatched target excluded.`;
    for (const c of session.cases) {
      progress.set(c.id, { loaded: new Set(c.review?.evidence?.loaded || []), errors: new Set(c.review?.evidence?.errors || []), failures: new Set(c.review?.evidence?.failures || []) });
      const button = document.createElement('button'); button.type = 'button'; button.dataset.case = c.id;
      const title = document.createElement('span'); title.textContent = c.title; const status = document.createElement('small');
      button.append(title, status); button.onclick = () => selectCase(c); $('cases').append(button);
    }
    for (const r of session.rubric) {
      const field = document.createElement('fieldset'); field.className = 'rubric-item';
      const legend = document.createElement('legend'); legend.textContent = r.text; field.append(legend);
      const options = document.createElement('div'); options.className = 'choices';
      for (const choice of r.choices || session.choices.map(value => ({ value, label: labels[value] }))) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'radio'; input.name = r.id; input.value = choice.value; label.append(input, document.createTextNode(choice.label)); options.append(label);
      }
      const definition = document.createElement('p'); definition.id = `${r.id}-definition`;
      definition.className = 'rubric-definition'; definition.textContent = r.definition;
      field.setAttribute('aria-describedby', definition.id);
      field.append(definition, options); $('rubric').append(field);
      if (r.issueField) {
        const group = document.createElement('fieldset'); group.id = `issues-${r.id}`; group.className = 'issue-group'; group.hidden = true;
        const legend = document.createElement('legend'); legend.textContent = r.issueQuestion; group.append(legend);
        const help = document.createElement('p'); help.textContent = 'Optional · Select all that apply. Unselected means not reported, not normal.'; group.append(help);
        for (const choice of r.issueOptions) {
          const label = document.createElement('label'), input = document.createElement('input');
          input.type = 'checkbox'; input.name = r.issueField; input.value = choice.value;
          label.append(input, document.createTextNode(choice.label)); group.append(label);
        }
        $('rubric').append(group);
      }
    }
    await selectCase(session.cases.find(c => c.review?.status !== 'final') || session.cases[0]);
  } catch (error) { $('fatal').hidden = false; $('fatal').textContent = `${remote ? 'Review server' : 'Local app'} unavailable: ${error.message}`; }
}
if (remote) {
  document.title = 'Series review';
  $('completion').textContent = 'Sign in to connect';
  $('privacy-summary').textContent = 'Research only · not for diagnosis · password-protected remote session';
  $('privacy-heading').textContent = 'Remote access';
  $('privacy-detail').textContent = $('sign-in-description').textContent;
  $('renderer-detail').textContent = 'Browser 2D canvas renderer, not the OHIF engine. Windowing and zoom apply to decoded pixels.';
  $('image').setAttribute('aria-label', 'Grayscale DICOM slice');
  $('logout').hidden = false; $('logout').onclick = clearSession;
  $('clear-session').onclick = clearSession;
  $('sign-in').oncancel = event => event.preventDefault();
  $('sign-in-form').onsubmit = async event => {
    event.preventDefault();
    if (authAttempt) return;
    authAttempt = true; $('sign-in-submit').disabled = true;
    try {
      const username = $('review-username').value;
      if (username.includes(':')) throw new Error('Username cannot contain a colon.');
      authorization = `Basic ${btoa(Array.from(new TextEncoder().encode(`${username}:${$('review-password').value}`), byte => String.fromCharCode(byte)).join(''))}`;
      $('review-password').value = '';
      const validated = await (await request('/api/session')).json();
      $('sign-in').close(); $('sign-in').hidden = true;
      if (session) {
        // Refresh the anti-CSRF token, not the form or revision: retain unsaved edits.
        session.csrf = validated.csrf;
        session.storage = validated.storage;
        session.assessmentCollection = validated.assessmentCollection;
        storageMessaging();
        if (dirty) $('save-status').textContent = 'Unsaved draft retained · choose Save draft to retry';
        else if (!image) await loadFrame();
        prefetchFrames();
      } else await initialize(validated);
    } catch (error) {
      authorization = ''; openSignIn(error.message); $('review-password').focus();
    } finally { authAttempt = false; $('sign-in-submit').disabled = false; }
  };
  openSignIn();
} else initialize();
