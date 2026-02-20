import React, { useEffect, useState } from 'react';
import {
  getMetadataFromOrthancStudyIdByKeys,
  getMetadataFromStudyByKeys,
} from '../../../platform/app/src/components/dicom_helpers';

type ReportItem = {
  mammoReport: string;
  comparisonReport: string;
  filepath: string;
};

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

const looksLikeOrthancId = (value: string | null): boolean => {
  if (!value) {
    return false;
  }
  return /^[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}-[a-f0-9]{8}$/i.test(value.trim());
};

const getUrlOrthancStudyId = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const value =
      params.get('orthancStudyId') ||
      params.get('OrthancStudyId') ||
      params.get('studyId') ||
      params.get('OrthancID') ||
      null;
    return value && value.trim() ? value.trim() : null;
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

const fetchStudyMetadataValueByUid = async (
  studyInstanceUID: string,
  metadataKeys: string[]
): Promise<string | null> => {
  return getMetadataFromStudyByKeys(studyInstanceUID, metadataKeys);
};

const ReportComparisonPanel: React.FC<{ servicesManager?: any }> = ({ servicesManager }) => {
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [displaySetVersion, setDisplaySetVersion] = useState(0);
  const totalReports = reportItems.length;
  const isJudgeMode = window.location.pathname.includes('/judge-mode');
  const comparisonReportKey = isJudgeMode ? 'groundTruthReport' : 'medGemmaReport';
  const comparisonReportKeys = isJudgeMode
    ? ['groundTruthReport', 'groundtruthReport']
    : ['medGemmaReport', 'medgemmaReport'];

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
        const urlStudyInstanceUID = getUrlStudyInstanceUID();
        const orthancStudyId = getUrlOrthancStudyId() ?? (looksLikeOrthancId(urlStudyInstanceUID) ? urlStudyInstanceUID : null);
        const activeStudyInstanceUID =
          orthancStudyId ? null : (urlStudyInstanceUID ?? getActiveStudyInstanceUID(servicesManager));

        if (!orthancStudyId && !activeStudyInstanceUID) {
          if (!cancelled) {
            setReportItems([]);
            setReportError('No active study found for report metadata lookup (missing StudyInstanceUID and orthancStudyId).');
          }
          return;
        }

        const getByKeys = (keys: string[]) =>
          orthancStudyId
            ? getMetadataFromOrthancStudyIdByKeys(orthancStudyId, keys)
            : fetchStudyMetadataValueByUid(activeStudyInstanceUID!, keys);

        const [mammoReport, comparisonReport] = await Promise.all([
          getByKeys(['mammoReport']),
          getByKeys(comparisonReportKeys),
        ]);

        if (!cancelled && (mammoReport || comparisonReport)) {
          setReportItems([
            {
              mammoReport: mammoReport ?? '',
              comparisonReport: comparisonReport ?? '',
              filepath: '',
            },
          ]);
          return;
        }

        if (!cancelled) {
          setReportItems([]);
          setReportError(
            orthancStudyId
              ? `Orthanc study metadata not found for OrthancStudyId ${orthancStudyId}. Expected keys: mammoReport and ${comparisonReportKey}.`
              : `Orthanc study metadata not found for StudyInstanceUID ${activeStudyInstanceUID}. Expected keys: mammoReport and ${comparisonReportKey}.`
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
  const currentMammoReport = reportItems[currentReportIndex]?.mammoReport || '';
  const currentComparisonReport = reportItems[currentReportIndex]?.comparisonReport || '';
  const canGoNext =
    !reportLoading && totalReports > 0 && currentReportIndex < totalReports - 1;
  const panelTitle = 'AI Report Comparison';
  const panelSubtitle = isJudgeMode
    ? 'Review AI-generated report (A) against the ground truth report.'
    : 'Review AI-generated report (A) against AI-generated report (B).';
  const firstReportLabel = isJudgeMode ? 'Generated Report' : 'AI-Generated Report (A)';
  const secondReportLabel = isJudgeMode ? 'Ground Truth Report' : 'AI-Generated Report (B)';

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
          <p className="text-base font-semibold">{panelTitle}</p>
          <p className="text-sm text-white/80">{panelSubtitle}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-white/70">{reportIndexLabel}</span>
          {canGoNext && (
            <button
              type="button"
              onClick={() => setCurrentReportIndex(prev => Math.min(totalReports - 1, prev + 1))}
              className="rounded-full bg-primary-light px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white"
            >
              Next
            </button>
          )}
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
              {firstReportLabel}
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentMammoReport || 'No AI-generated report available for this entry.'}
            </p>
          </div>
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              {secondReportLabel}
            </div>
            <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentComparisonReport ||
                (isJudgeMode
                  ? 'No ground truth report available for this entry.'
                  : 'No AI-generated report (B) available for this entry.')}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReportComparisonPanel;
