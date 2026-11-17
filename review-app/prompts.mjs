import { createHash } from 'node:crypto';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const pairKey = row => JSON.stringify([row.studyUID, row.seriesUID]);
export function buildPromptMetadata(manifest, index, documents, sessions) {
  const local = new Map(index.series.map(row => [pairKey(row), row]));
  const scoped = documents.filter(d => sessions.some(s => Date.parse(d.createdAt) >= s.start && Date.parse(d.createdAt) < s.end));
  return manifest.cases.map(c => {
    const logs = scoped.filter(d => d.studyInstanceUID === c.studyUID && d.seriesInstanceUID === c.seriesUID);
    const prompts = [...new Set(logs.map(d => d.promptText).filter(t => typeof t === 'string' && t.trim()))].sort();
    const descriptions = [...new Set(local.get(pairKey(c))?.descriptions || [])].filter(Boolean).sort();
    return { caseId: c.id, descriptions, prompts: prompts.map(text => ({ text, events: logs.filter(d => d.promptText === text).map(d => ({ documentId: d.documentId, createdAt: d.createdAt, promptKey: d.promptKey, seriesDescription: d.seriesDescription ?? null })) })), missingPromptEvents: logs.filter(d => !d.promptText?.trim()).length, eventCount: logs.length };
  });
}

export function publicPrompt(metadata) {
  return {
    description: metadata?.descriptions.length === 1 ? metadata.descriptions[0] : null,
    descriptions: metadata?.descriptions || [],
    prompts: (metadata?.prompts || []).map(p => ({ text: p.text, eventCount: p.events.length })),
    eventCount: metadata?.eventCount || 0,
    missingPromptEvents: metadata?.missingPromptEvents || 0,
    originalGenerationPromptVerified: false,
  };
}
