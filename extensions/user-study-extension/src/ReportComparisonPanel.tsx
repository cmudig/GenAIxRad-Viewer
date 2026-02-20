import React, { useEffect, useState } from 'react';

type ReportItem = {
  aiGen: string;
  groundTruth: string;
  filepath: string;
};

const ORTHANC_DIRECT_BASE = 'http://localhost:8042';

const getUrlStudyInstanceUID = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const firstFromGetAll = params.getAll('StudyInstanceUIDs')?.[0];
    const studyUid = firstFromGetAll ?? params.get('StudyInstanceUIDs');
    return studyUid && studyUid.trim() ? studyUid.trim() : null;
  } catch {
    return null;
  }
};

const getActiveStudyInstanceUID = (servicesManager: any): string | null => {
  const { displaySetService, viewportGridService } = servicesManager?.services ?? {};
  if (!displaySetService || !viewportGridService) {
    return null;
  }

  const state = viewportGridService.getState?.() ?? viewportGridService.getViewportGridState?.();
  const activeViewportId = state?.activeViewportId ?? null;
  const viewports = state?.viewports;
  const activeViewport =
    viewports?.get?.(activeViewportId) ??
    (Array.isArray(viewports) ? viewports.find(v => v?.viewportId === activeViewportId) : null) ??
    (viewports && typeof viewports === 'object' ? (viewports[activeViewportId] ?? null) : null);
  const activeDisplaySetUID = activeViewport?.displaySetInstanceUIDs?.[0] ?? null;
  const activeDisplaySet = activeDisplaySetUID
    ? displaySetService.getDisplaySetByUID?.(activeDisplaySetUID)
    : null;

  return activeDisplaySet?.StudyInstanceUID ?? null;
};

const fetchStudyMetadataValue = async (
  studyInstanceUID: string,
  metadataKeys: string[],
  attemptedBases: string[] = []
): Promise<string | null> => {
  attemptedBases.push(ORTHANC_DIRECT_BASE);
  const orthancStudyIds: string[] = [];

  const findResponse = await fetch(`${ORTHANC_DIRECT_BASE}/tools/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      Level: 'Study',
      Expand: true,
      Query: { StudyInstanceUID: studyInstanceUID },
    }),
  });

  if (findResponse.ok) {
    const findResults = await findResponse.json();
    if (Array.isArray(findResults)) {
      findResults.forEach(item => {
        const id = item?.ID ?? item?.ID?.toString?.();
        if (typeof id === 'string' && id.trim()) {
          orthancStudyIds.push(id);
        }
      });
    }
  }

  if (!orthancStudyIds.length) {
    const params = new URLSearchParams({ expand: '1', requestedTags: 'StudyInstanceUID' });
    const studiesResponse = await fetch(`${ORTHANC_DIRECT_BASE}/studies?${params.toString()}`);
    if (studiesResponse.ok) {
      const studies = await studiesResponse.json();
      if (Array.isArray(studies)) {
        studies.forEach(item => {
          const uid =
            item?.RequestedTags?.StudyInstanceUID ?? item?.MainDicomTags?.StudyInstanceUID ?? null;
          const id = item?.ID ?? null;
          if (uid === studyInstanceUID && typeof id === 'string' && id.trim()) {
            orthancStudyIds.push(id);
          }
        });
      }
    }
  }

  for (const orthancStudyId of Array.from(new Set(orthancStudyIds))) {
    for (const key of metadataKeys) {
      const metadataResponse = await fetch(
        `${ORTHANC_DIRECT_BASE}/studies/${orthancStudyId}/metadata/${key}`
      );
      if (metadataResponse.ok) {
        const value = (await metadataResponse.text())?.trim();
        if (value) {
          return value;
        }
      }
    }
  }

  return null;
};

const ReportComparisonPanel: React.FC<{ servicesManager?: any }> = ({ servicesManager }) => {
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [displaySetVersion, setDisplaySetVersion] = useState(0);
  const totalReports = reportItems.length;

  useEffect(() => {
    const displaySetService = servicesManager?.services?.displaySetService;
    if (!displaySetService?.subscribe) {
      return;
    }

    const eventNames = [
      displaySetService.EVENTS?.DISPLAY_SETS_ADDED,
      displaySetService.EVENTS?.DISPLAY_SETS_CHANGED,
      displaySetService.EVENTS?.DISPLAY_SET_SERIES_METADATA_INVALIDATED,
    ].filter(Boolean);

    const subs = eventNames.map(eventName =>
      displaySetService.subscribe(eventName, () => setDisplaySetVersion(v => v + 1))
    );

    return () => subs.forEach(sub => sub?.unsubscribe?.());
  }, [servicesManager]);

  useEffect(() => {
    let cancelled = false;

    const loadReports = async () => {
      setReportLoading(true);
      setReportError('');

      try {
        const activeStudyInstanceUID =
          getUrlStudyInstanceUID() ?? getActiveStudyInstanceUID(servicesManager);

        if (!activeStudyInstanceUID) {
          if (!cancelled) {
            setReportItems([]);
            setReportError('No active study found for report metadata lookup.');
          }
          return;
        }

        const attemptedBases: string[] = [];
        const [aiReport, groundTruthReport] = await Promise.all([
          fetchStudyMetadataValue(activeStudyInstanceUID, ['mammoReport'], attemptedBases),
          fetchStudyMetadataValue(
            activeStudyInstanceUID,
            ['groundTruthReport', 'groundtruthReport'],
            attemptedBases
          ),
        ]);

        if (!cancelled && (aiReport || groundTruthReport)) {
          setReportItems([
            {
              aiGen: aiReport ?? '',
              groundTruth: groundTruthReport ?? '',
              filepath: '',
            },
          ]);
          return;
        }

        if (!cancelled) {
          setReportItems([]);
          setReportError(
            `Orthanc study metadata not found for StudyInstanceUID ${activeStudyInstanceUID}. Expected keys: mammoReport and groundTruthReport. Bases tried: ${Array.from(new Set(attemptedBases)).join(', ')}`
          );
        }
      } catch (loadError) {
        console.error('ReportComparisonPanel: failed to load reports', loadError);
        if (!cancelled) {
          setReportItems([]);
          setReportError('Unable to load Orthanc report metadata. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setReportLoading(false);
        }
      }
    };

    loadReports();

    return () => {
      cancelled = true;
    };
  }, [servicesManager, displaySetVersion]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      const delta = typeof detail.delta === 'number' ? detail.delta : 0;
      if (!delta || totalReports === 0) {
        return;
      }
      setCurrentReportIndex(prev =>
        Math.min(Math.max(prev + delta, 0), Math.max(totalReports - 1, 0))
      );
    };

    document.addEventListener('reportAdvance', handler);
    return () => document.removeEventListener('reportAdvance', handler);
  }, [totalReports]);
  const reportIndexLabel = totalReports > 0 ? `${currentReportIndex + 1}/${totalReports}` : '0/0';
  const currentAiReport = reportItems[currentReportIndex]?.aiGen || '';
  const currentGroundTruthReport = reportItems[currentReportIndex]?.groundTruth || '';
  const canGoPrev = !reportLoading && totalReports > 0 && currentReportIndex > 0;
  const canGoNext =
    !reportLoading && totalReports > 0 && currentReportIndex < totalReports - 1;

  useEffect(() => {
    if (!totalReports) {
      setCurrentReportIndex(0);
      return;
    }

    setCurrentReportIndex(prev => Math.min(prev, totalReports - 1));
  }, [totalReports]);

  useEffect(() => {
    document.dispatchEvent(
      new CustomEvent('reportIndexChanged', {
        detail: { index: currentReportIndex, total: totalReports },
      })
    );
  }, [currentReportIndex, totalReports]);

  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-base font-semibold">Report Comparison</p>
          <p className="text-sm text-white/80">
            Review the AI-generated report against the ground truth report.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-white/70">{reportIndexLabel}</span>
          <button
            type="button"
            onClick={() => setCurrentReportIndex(prev => Math.max(0, prev - 1))}
            disabled={!canGoPrev}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              canGoPrev
                ? 'border border-white/30 text-white hover:border-white'
                : 'cursor-not-allowed border border-white/10 text-white/40'
            }`}
          >
            Prev
          </button>
          <button
            type="button"
            onClick={() => setCurrentReportIndex(prev => Math.min(totalReports - 1, prev + 1))}
            disabled={!canGoNext}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
              canGoNext
                ? 'bg-primary-light text-black hover:bg-white'
                : 'cursor-not-allowed bg-white/10 text-white/40'
            }`}
          >
            Next
          </button>
        </div>
      </div>

      {reportError && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          {reportError}
        </div>
      )}

      {!reportLoading && !reportError && totalReports === 0 && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          No reports available yet.
        </div>
      )}

      {reportLoading && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/70">
          Loading report data...
        </div>
      )}

      {totalReports > 0 && !reportLoading && (
        <div className="mt-4 flex flex-col gap-3">
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              AI-Generated Report
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentAiReport || 'No AI-generated report available for this entry.'}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              Ground Truth Report
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentGroundTruthReport || 'No ground truth report available for this entry.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportComparisonPanel;
