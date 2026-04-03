import React, { useEffect, useState } from 'react';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import {
  getMetadataFromOrthancStudyIdByKeys,
  getMetadataFromStudyByKeys,
} from '../../../platform/app/src/components/dicom_helpers';
import { auth, db } from '../../../platform/app/src/firebase';
import { JUDGING_CRITERIA } from './JudgingCriteriaPanel';

type ReportItem = {
  mammoReport: string;
  comparisonReport: string;
  filepath: string;
  judgeMetadata: Record<string, string>;
};

type CriterionFeedback = {
  status: 'correct' | 'incorrect' | null;
  correction: string;
};

type FeedbackByReport = Record<number, Record<string, CriterionFeedback>>;
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

const formatJudgeMetadataValue = (value: string | undefined): string => {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return 'No data available';
  }

  if (normalizedValue === '1') {
    return 'True';
  }

  if (normalizedValue === '0') {
    return 'False';
  }

  return normalizedValue;
};

const formatJudgeExplanationValue = (value: string | undefined): string => {
  const normalizedValue = value?.trim();
  if (!normalizedValue || normalizedValue.toLowerCase() === 'nan') {
    return 'Nothing to report';
  }
  return normalizedValue;
};

const ReportComparisonPanel: React.FC<{ servicesManager?: any }> = ({ servicesManager }) => {
  const { uiNotificationService } = servicesManager?.services ?? {};
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [displaySetVersion, setDisplaySetVersion] = useState(0);
  const [criterionFeedback, setCriterionFeedback] = useState<FeedbackByReport>({});
  const [isSubmittingJudgeReport, setIsSubmittingJudgeReport] = useState(false);
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

        const [mammoReport, comparisonReport, judgeMetadataEntries] = await Promise.all([
          getByKeys(['mammoReport']),
          getByKeys(comparisonReportKeys),
          isJudgeMode
            ? Promise.all(
                JUDGING_CRITERIA.flatMap(criterion => [
                  (async () =>
                    [
                      criterion.metadataKey,
                      (await getByKeys([criterion.metadataKey])) ?? 'No data available',
                    ] as [string, string])(),
                  (async () =>
                    [
                      criterion.explanationMetadataKey,
                      (await getByKeys([criterion.explanationMetadataKey])) ?? 'No data available',
                    ] as [string, string])(),
                ])
              )
            : Promise.resolve([] as [string, string][]),
        ]);

        if (!cancelled && (mammoReport || comparisonReport)) {
          setReportItems([
            {
              mammoReport: mammoReport ?? '',
              comparisonReport: comparisonReport ?? '',
              filepath: '',
              judgeMetadata: Object.fromEntries(judgeMetadataEntries),
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
  const currentJudgeMetadata = reportItems[currentReportIndex]?.judgeMetadata || {};
  const currentCriterionFeedback = criterionFeedback[currentReportIndex] || {};
  const completedJudgeCriteriaCount = JUDGING_CRITERIA.filter(
    criterion => !!currentCriterionFeedback[criterion.metadataKey]?.status
  ).length;
  const canGoNext =
    !reportLoading && totalReports > 0 && currentReportIndex < totalReports - 1;
  const panelTitle = 'AI Report Comparison';
  const panelSubtitle = isJudgeMode
    ? 'Review AI-generated report against the ground truth report.'
    : 'Review AI-generated report (A) against AI-generated report (B).';
  const firstReportLabel = isJudgeMode
    ? 'Generated Report (Candidate Report)'
    : 'AI-Generated Report (A)';
  const secondReportLabel = isJudgeMode
    ? 'Ground Truth Report (Reference Report)'
    : 'AI-Generated Report (B)';

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

  const setCriterionStatus = (
    reportIndex: number,
    metadataKey: string,
    status: CriterionFeedback['status']
  ) => {
    setCriterionFeedback(prev => {
      const existing = prev[reportIndex]?.[metadataKey] ?? {
        status: null,
        correction: '',
      };

      return {
        ...prev,
        [reportIndex]: {
          ...(prev[reportIndex] || {}),
          [metadataKey]: {
            status,
            correction: status === 'incorrect' ? existing.correction : '',
          },
        },
      };
    });
  };

  const setCriterionCorrection = (reportIndex: number, metadataKey: string, correction: string) => {
    setCriterionFeedback(prev => ({
      ...prev,
      [reportIndex]: {
        ...(prev[reportIndex] || {}),
        [metadataKey]: {
          status: prev[reportIndex]?.[metadataKey]?.status ?? 'incorrect',
          correction,
        },
      },
    }));
  };

  const handleSubmitJudgeReport = async () => {
    if (!auth?.currentUser?.uid) {
      uiNotificationService?.show?.({
        title: 'Unable to Submit',
        message: 'You must be signed in before submitting the judge report.',
        type: 'warning',
        duration: 3000,
      });
      return;
    }

    const incompleteCriterion = JUDGING_CRITERIA.find(criterion => {
      const feedback = currentCriterionFeedback[criterion.metadataKey];
      if (!feedback?.status) {
        return true;
      }
      if (feedback.status === 'incorrect' && !feedback.correction.trim()) {
        return true;
      }
      return false;
    });

    if (incompleteCriterion) {
      uiNotificationService?.show?.({
        title: 'Judge Report Incomplete',
        message:
          'Please mark every criterion as correct or incorrect, and add a correction for each incorrect item.',
        type: 'warning',
        duration: 3500,
      });
      return;
    }

    setIsSubmittingJudgeReport(true);

    try {
      const urlStudyInstanceUID = getUrlStudyInstanceUID();
      const orthancStudyId =
        getUrlOrthancStudyId() ?? (looksLikeOrthancId(urlStudyInstanceUID) ? urlStudyInstanceUID : null);
      const activeStudyInstanceUID =
        orthancStudyId ? null : (urlStudyInstanceUID ?? getActiveStudyInstanceUID(servicesManager));

      const criteriaResponses = Object.fromEntries(
        JUDGING_CRITERIA.map(criterion => {
          const feedback = currentCriterionFeedback[criterion.metadataKey];
          return [
            criterion.metadataKey,
            {
              title: criterion.title,
              llmJudgeValue: currentJudgeMetadata[criterion.metadataKey] ?? 'No data available',
              llmJudgeExplanation:
                currentJudgeMetadata[criterion.explanationMetadataKey] ?? 'No data available',
              status: feedback?.status ?? null,
              correction: feedback?.status === 'incorrect' ? feedback.correction.trim() : '',
            },
          ];
        })
      );

      await addDoc(
        collection(db, 'radiology-user-study', auth.currentUser.uid, 'judge-report-submissions'),
        {
          createdAt: serverTimestamp(),
          reportIndex: currentReportIndex,
          studyInstanceUID: activeStudyInstanceUID ?? null,
          orthancStudyId: orthancStudyId ?? null,
          generatedReport: currentMammoReport,
          comparisonReport: currentComparisonReport,
          criteriaResponses,
        }
      );

      uiNotificationService?.show?.({
        title: 'Judge Report Submitted',
        message: 'Your LLM-as-a-Judge review has been saved.',
        type: 'success',
        duration: 3000,
      });
    } catch (error) {
      console.error('ReportComparisonPanel: failed to submit judge report', error);
      uiNotificationService?.show?.({
        title: 'Submission Failed',
        message: 'Unable to save the judge report right now. Please try again.',
        type: 'error',
        duration: 3500,
      });
    } finally {
      setIsSubmittingJudgeReport(false);
    }
  };

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
        <div
          className={`mt-4 grid gap-3 ${
            isJudgeMode ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              {firstReportLabel}
            </div>
            <div className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentMammoReport || 'No AI-generated report available for this entry.'}
            </div>
          </div>
          <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-white/60">
              {secondReportLabel}
            </div>
            <div className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-white/90">
              {currentComparisonReport
                ? currentComparisonReport
                : isJudgeMode
                  ? 'No ground truth report available for this entry.'
                  : 'No AI-generated report (B) available for this entry.'}
            </div>
          </div>
          {isJudgeMode && (
            <div className="rounded-2xl border border-white/10 bg-[#0b1639] p-4 shadow-inner shadow-black/30 xl:col-span-2">
              <div className="max-h-[34rem] overflow-y-auto pr-1">
                <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                  <span>LLM-as-a-Judge Report</span>
                  <span>{`${completedJudgeCriteriaCount}/${JUDGING_CRITERIA.length} Completed`}</span>
                </div>
                <div className="mt-3 space-y-3">
                  {JUDGING_CRITERIA.map((criterion, index) => (
                    <div
                      key={`${criterion.title}-${index}`}
                      className="rounded-xl border border-white/10 bg-[#091538] px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <p className="text-sm font-semibold text-white/90">
                          {index + 1}. {criterion.title}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setCriterionStatus(currentReportIndex, criterion.metadataKey, 'correct')
                            }
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                              currentCriterionFeedback[criterion.metadataKey]?.status === 'correct'
                                ? 'border border-[#86efac] bg-[#16a34a] text-white shadow-sm'
                                : 'bg-[#0d1b46] text-white/80 hover:bg-[#12245a]'
                            }`}
                          >
                            Correct
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCriterionStatus(currentReportIndex, criterion.metadataKey, 'incorrect')
                            }
                            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                              currentCriterionFeedback[criterion.metadataKey]?.status === 'incorrect'
                                ? 'bg-red-500/25 text-red-100 ring-1 ring-red-300'
                                : 'bg-[#0d1b46] text-white/80 hover:bg-[#12245a]'
                            }`}
                          >
                            Incorrect
                          </button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/75">
                        {`${formatJudgeMetadataValue(currentJudgeMetadata[criterion.metadataKey])}: ${formatJudgeExplanationValue(
                          currentJudgeMetadata[criterion.explanationMetadataKey]
                        )}`}
                      </p>
                      {currentCriterionFeedback[criterion.metadataKey]?.status === 'incorrect' && (
                        <textarea
                          rows={2}
                          value={currentCriterionFeedback[criterion.metadataKey]?.correction || ''}
                          onChange={event =>
                            setCriterionCorrection(
                              currentReportIndex,
                              criterion.metadataKey,
                              event.target.value
                            )
                          }
                          className="mt-3 min-h-[56px] w-full rounded-lg border border-white/15 bg-[#0d1b46] p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/40 focus:border-white/30"
                          placeholder="Describe what is incorrect and provide the corrected assessment..."
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={handleSubmitJudgeReport}
                    disabled={isSubmittingJudgeReport}
                    className="rounded-full bg-primary-light px-5 py-2 text-sm font-semibold text-black transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmittingJudgeReport ? 'Submitting...' : 'Submit Report'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReportComparisonPanel;
