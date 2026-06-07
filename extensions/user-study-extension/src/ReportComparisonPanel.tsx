import React, { useEffect, useState } from 'react';
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  getMetadataFromOrthancStudyIdByKeys,
  getMetadataFromStudyByKeys,
  getPatientIdFromStudyInstanceUid,
} from '../../../platform/app/src/components/dicom_helpers';
import { auth, db } from '../../../platform/app/src/firebase';
import { JUDGING_CRITERIA } from './JudgingCriteriaPanel';
import { recordCompletedModeCaseCount } from './studyViewCounts';
import StudyLoadingOverlay from './StudyLoadingOverlay';
import { useStudyViewportImagesReady } from './studyViewportReadiness';

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
type ModeProgress = {
  participantCode: string;
  modeId: 'participant' | 'judge';
  route: '/user-study-mode' | '/judge-mode';
  targetCount: number;
  studyUIDs: string[];
  completedStudyUIDs: string[];
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
};

const getModeProgressKey = (participantCode: string, modeId: 'participant' | 'judge') =>
  `studyModeProgress:${participantCode}:${modeId}`;

const readModeProgress = (
  participantCode: string,
  modeId: 'participant' | 'judge'
): ModeProgress | null => {
  try {
    const raw = window.sessionStorage.getItem(getModeProgressKey(participantCode, modeId));
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as ModeProgress;
  } catch {
    return null;
  }
};

const writeModeProgress = (progress: ModeProgress) => {
  window.sessionStorage.setItem(
    getModeProgressKey(progress.participantCode, progress.modeId),
    JSON.stringify(progress)
  );
};

const getModeCaseProgressLabel = ({
  participantCode,
  modeId,
  currentStudyUID,
}: {
  participantCode: string | null;
  modeId: 'participant' | 'judge';
  currentStudyUID: string | null;
}): string | null => {
  if (!participantCode) {
    return null;
  }

  const progress = readModeProgress(participantCode, modeId);
  if (!progress || !progress.targetCount) {
    return null;
  }

  const total = Math.max(1, progress.targetCount);
  const completedSet = new Set(progress.completedStudyUIDs || []);
  const isCurrentAlreadyCompleted = currentStudyUID ? completedSet.has(currentStudyUID) : false;
  const current = Math.max(
    1,
    Math.min(total, completedSet.size + (isCurrentAlreadyCompleted ? 0 : 1))
  );

  return `${current}/${total}`;
};

const getParticipantCodeFromContext = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('participantCode');
    if (fromQuery && fromQuery.trim()) {
      return fromQuery.trim();
    }
  } catch {
    // Ignore URL parsing errors.
  }

  try {
    const stored = window.sessionStorage.getItem('participantDemographics');
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    const fromSession = parsed?.participantCode;
    if (typeof fromSession === 'string' && fromSession.trim()) {
      return fromSession.trim();
    }
  } catch {
    // Ignore session parsing errors.
  }

  return null;
};

const getParticipantDemographicsFromSession = (): Record<string, any> | null => {
  try {
    const stored = window.sessionStorage.getItem('participantDemographics');
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return {
      participantCode: parsed.participantCode || null,
      role: parsed.role || null,
      mammogramReviewExperienceYears: parsed.mammogramReviewExperienceYears || null,
      aiHealthcarePerspective: parsed.aiHealthcarePerspective || null,
      capturedAt: parsed.createdAt || null,
    };
  } catch {
    return null;
  }
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

const normalizeReviewedStudyParticipantId = (value: string | null): string | null => {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized;
};

const getReviewedStudyParticipantId = async (studyInstanceUID: string | null): Promise<string | null> => {
  if (!studyInstanceUID) {
    return null;
  }

  const patientIdFromDicom = await getPatientIdFromStudyInstanceUid(studyInstanceUID);
  const normalizedPatientIdFromDicom = normalizeReviewedStudyParticipantId(patientIdFromDicom);
  if (normalizedPatientIdFromDicom) {
    return normalizedPatientIdFromDicom;
  }

  const metadataKeys = ['participantID', 'participantId', 'participant_id'];
  const value = await getMetadataFromStudyByKeys(studyInstanceUID, metadataKeys);
  return normalizeReviewedStudyParticipantId(value);
};

const toSafeMapKey = (value: string): string => encodeURIComponent(value.trim()).replace(/\./g, '%2E');

const isMissingOrNan = (value: string | undefined): boolean => {
  const normalizedValue = value?.trim();
  return !normalizedValue || normalizedValue.toLowerCase() === 'nan';
};

const formatJudgeExplanationValue = (value: string | undefined): string => {
  if (isMissingOrNan(value)) {
    return 'Nothing to report';
  }

  const normalizeLine = (line: string): string =>
    line
      .trim()
      .replace(/^(true|false|yes|no)\b\s*[:.)-]?\s*/i, '')
      .replace(/^\(?\d+\)?\s*[:.)-]\s*/, '')
      .trim();

  const normalizedValue = value!
    .split(/\s*\|\s*|\r?\n/)
    .map(normalizeLine)
    .filter(Boolean)
    .join('\n');

  return normalizedValue || 'Nothing to report';
};

const ReportComparisonPanel: React.FC<{ servicesManager?: any }> = ({ servicesManager }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { uiNotificationService } = servicesManager?.services ?? {};
  const [reportItems, setReportItems] = useState<ReportItem[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [criterionFeedback, setCriterionFeedback] = useState<FeedbackByReport>({});
  const [isSubmittingJudgeReport, setIsSubmittingJudgeReport] = useState(false);
  const totalReports = reportItems.length;
  const isJudgeMode = window.location.pathname.includes('/judge-mode');
  const imagesReady = useStudyViewportImagesReady(servicesManager, `${location.search}:${isJudgeMode}`);
  const shouldGateOnImages = !isJudgeMode;
  const showImageLoadingOverlay = shouldGateOnImages && !imagesReady && !reportError;
  const comparisonReportKey = isJudgeMode ? 'groundTruthReport' : 'medGemmaReport';
  const comparisonReportKeys = isJudgeMode
    ? ['groundTruthReport', 'groundtruthReport']
    : ['medGemmaReport', 'medgemmaReport'];

  useEffect(() => {
    let cancelled = false;

    const loadReports = async () => {
      setReportLoading(true);
      setReportError('');

      try {
        const urlStudyInstanceUID = getUrlStudyInstanceUID();
        const orthancStudyId =
          getUrlOrthancStudyId() ??
          (looksLikeOrthancId(urlStudyInstanceUID) ? urlStudyInstanceUID : null);
        const activeStudyInstanceUID = orthancStudyId
          ? null
          : (urlStudyInstanceUID ?? getActiveStudyInstanceUID(servicesManager));

        if (!orthancStudyId && !activeStudyInstanceUID) {
          if (!cancelled) {
            setReportItems([]);
            setReportError(
              'No active study found for report metadata lookup (missing StudyInstanceUID and orthancStudyId).'
            );
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
                JUDGING_CRITERIA.map(criterion =>
                  (async () =>
                    [
                      criterion.explanationMetadataKey,
                      (await getByKeys([criterion.explanationMetadataKey])) ?? 'No data available',
                    ] as [string, string])(),
                )
              )
            : Promise.resolve([] as [string, string][]),
        ]);

        if (!cancelled && (mammoReport || comparisonReport)) {
          const caseStudyUIDForLog = activeStudyInstanceUID || urlStudyInstanceUID || null;
          if (isJudgeMode) {
            getReviewedStudyParticipantId(caseStudyUIDForLog)
              .then(patientId => {
                console.info('[JudgeMode] Loaded case', {
                  studyInstanceUID: caseStudyUIDForLog,
                  patientId: patientId || 'unknown',
                });
              })
              .catch(error => {
                console.warn('[JudgeMode] Could not resolve patient ID for loaded case', {
                  studyInstanceUID: caseStudyUIDForLog,
                  error,
                });
              });
          }
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
  }, [servicesManager, location.search, isJudgeMode]);

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
  const participantCodeForCaseProgress = getParticipantCodeFromContext();
  const currentStudyUIDForCaseProgress = getUrlStudyInstanceUID() ?? getUrlOrthancStudyId();
  const modeCaseProgressLabel = getModeCaseProgressLabel({
    participantCode: participantCodeForCaseProgress,
    modeId: isJudgeMode ? 'judge' : 'participant',
    currentStudyUID: currentStudyUIDForCaseProgress,
  });
  const reportIndexLabel = modeCaseProgressLabel
    ? `Case ${modeCaseProgressLabel.replace('/', ' of ')}`
    : totalReports > 0
      ? `Case ${currentReportIndex + 1} of ${totalReports}`
      : 'Case 1 of 1';
  const currentMammoReport = reportItems[currentReportIndex]?.mammoReport || '';
  const currentComparisonReport = reportItems[currentReportIndex]?.comparisonReport || '';
  const currentJudgeMetadata = reportItems[currentReportIndex]?.judgeMetadata || {};
  const currentCriterionFeedback = criterionFeedback[currentReportIndex] || {};
  const completedJudgeCriteriaCount = JUDGING_CRITERIA.filter(
    criterion => !!currentCriterionFeedback[criterion.metadataKey]?.status
  ).length;
  const allJudgeCriteriaAnswered = completedJudgeCriteriaCount === JUDGING_CRITERIA.length;
  const remainingJudgeCriteriaCount = Math.max(
    0,
    JUDGING_CRITERIA.length - completedJudgeCriteriaCount
  );
  const canGoNext = !reportLoading && totalReports > 0 && currentReportIndex < totalReports - 1;
  const panelTitle = 'AI Report Comparison';
  const panelSubtitle = isJudgeMode
    ? 'Review Report A (Candidate report) against Report B (reference report) and judge whether the candidate assessment is correct.'
    : 'Review AI-generated report (A) against AI-generated report (B).';
  const firstReportLabel = isJudgeMode
    ? 'Report A (Candidate Report)'
    : 'AI-Generated Report (A)';
  const secondReportLabel = isJudgeMode
    ? 'Report B (Reference Report)'
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
    const participantId = getParticipantCodeFromContext() || auth.currentUser?.uid || 'anonymous';

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
        getUrlOrthancStudyId() ??
        (looksLikeOrthancId(urlStudyInstanceUID) ? urlStudyInstanceUID : null);
      const activeStudyInstanceUID = orthancStudyId
        ? null
        : (urlStudyInstanceUID ?? getActiveStudyInstanceUID(servicesManager));
      const reviewedStudyInstanceUID = activeStudyInstanceUID || urlStudyInstanceUID;
      const reviewedStudyParticipantId =
        await getReviewedStudyParticipantId(reviewedStudyInstanceUID);
      const participantCode = getParticipantCodeFromContext();
      const demographics = getParticipantDemographicsFromSession();
      const judgingPatientKey = reviewedStudyParticipantId
        ? toSafeMapKey(reviewedStudyParticipantId)
        : null;

      if (!judgingPatientKey) {
        throw new Error('Reviewed study participant ID is required to save judging data.');
      }

      const criteriaResponses = Object.fromEntries(
        JUDGING_CRITERIA.map(criterion => {
          const feedback = currentCriterionFeedback[criterion.metadataKey];
          const rawJudgeExplanation = currentJudgeMetadata[criterion.explanationMetadataKey];
          const formattedJudgeExplanation = formatJudgeExplanationValue(rawJudgeExplanation);

          return [
            criterion.metadataKey,
            {
              title: criterion.title,
              llmJudgeExplanation: formattedJudgeExplanation,
              status: feedback?.status ?? null,
              correction: feedback?.status === 'incorrect' ? feedback.correction.trim() : '',
            },
          ];
        })
      );

      const judgingPayload = {
        createdAt: serverTimestamp(),
        participantCode: getParticipantCodeFromContext(),
        reportIndex: currentReportIndex,
        studyInstanceUID: activeStudyInstanceUID ?? null,
        reviewedStudyInstanceUID: reviewedStudyInstanceUID ?? null,
        reviewedStudyParticipantId,
        generatedReport: currentMammoReport,
        comparisonReport: currentComparisonReport,
        criteriaResponses,
      };

      const evalDocRef = doc(db, 'mammogram-study', 'participant-eval');
      try {
        const updates: Record<string, any> = {
          [`participants.${participantId}.judging.${judgingPatientKey}`]: judgingPayload,
        };
        if (demographics) {
          updates[`participants.${participantId}.demographics`] = demographics;
        }
        await updateDoc(evalDocRef, updates);
      } catch (updateError: any) {
        if (updateError?.code === 'not-found') {
          const payload = {
            participants: {
              [participantId]: {
                demographics: demographics || null,
                judging: {
                  [judgingPatientKey]: judgingPayload,
                },
              },
            },
          };
          await setDoc(evalDocRef, payload, { merge: true });
        } else {
          throw updateError;
        }
      }
      if (reviewedStudyParticipantId) {
        await recordCompletedModeCaseCount({
          participantId,
          participantCode,
          modeId: 'judge',
          patientId: reviewedStudyParticipantId
        });
      }

      console.info('[JudgeMode] Submit completed for case', {
        participantId,
        participantCode,
        urlStudyInstanceUID,
        activeStudyInstanceUID,
        reviewedStudyInstanceUID,
        reviewedStudyParticipantId: reviewedStudyParticipantId || 'unknown',
      });

      uiNotificationService?.show?.({
        title: 'Judge Report Submitted',
        message: 'Your candidate-vs-reference review has been saved.',
        type: 'success',
        duration: 3000,
      });

      // Progress through assigned Judge studies for this participant.
      const currentStudyUID = urlStudyInstanceUID || activeStudyInstanceUID;
      const progress = participantCode ? readModeProgress(participantCode, 'judge') : null;

      if (!participantCode || !progress) {
        return;
      }

      const completedSet = new Set(progress.completedStudyUIDs);
      const assignedCurrentStudyUID =
        (currentStudyUID && progress.studyUIDs.includes(currentStudyUID) && currentStudyUID) ||
        progress.studyUIDs.find(uid => !completedSet.has(uid)) ||
        null;
      if (assignedCurrentStudyUID) {
        completedSet.add(assignedCurrentStudyUID);
      }

      const completedStudyUIDs = Array.from(completedSet);
      const nextStudyUID = progress.studyUIDs.find(uid => !completedSet.has(uid)) || null;
      const nextProgress: ModeProgress = {
        ...progress,
        completedStudyUIDs,
        isComplete: completedStudyUIDs.length >= progress.targetCount || !nextStudyUID,
        updatedAt: new Date().toISOString(),
      };
      writeModeProgress(nextProgress);

      console.info('[JudgeMode] Case progression', {
        participantCode,
        completedStudyUIDs,
        nextStudyUID,
        isComplete: nextProgress.isComplete,
      });

      if (nextProgress.isComplete) {
        navigate(`/?participantCode=${encodeURIComponent(participantCode)}`);
        return;
      }

      if (nextStudyUID) {
        navigate(
          `/judge-mode?StudyInstanceUIDs=${encodeURIComponent(
            nextStudyUID
          )}&participantCode=${encodeURIComponent(participantCode)}`
        );
      }
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
    <div className="shadow-primary-main/10 flex h-full min-h-0 flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      {showImageLoadingOverlay && <StudyLoadingOverlay />}
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
              className="bg-primary-light rounded-full px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white"
            >
              Next
            </button>
          )}
        </div>
      </div>

      <div className="ohif-scrollbar mt-3 min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
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
                <div className="pb-6 pr-1">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold uppercase tracking-wide text-white/60">
                      <span>Candidate-vs-Reference Review</span>
                      <span>{`${completedJudgeCriteriaCount}/${JUDGING_CRITERIA.length} Completed`}</span>
                      {remainingJudgeCriteriaCount > 0 && (
                        <span>{`${remainingJudgeCriteriaCount} remaining`}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSubmitJudgeReport}
                      disabled={isSubmittingJudgeReport || !allJudgeCriteriaAnswered}
                      className={`rounded-full px-5 py-2 text-sm font-semibold transition-colors ${
                        isSubmittingJudgeReport || !allJudgeCriteriaAnswered
                          ? 'cursor-not-allowed bg-white/15 text-white/50'
                          : 'bg-[#60a5fa] text-black hover:bg-[#93c5fd]'
                      }`}
                    >
                      {isSubmittingJudgeReport ? 'Submitting...' : 'Submit Report'}
                    </button>
                  </div>
                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-semibold text-white/70">
                      For each criterion, judge whether you accept or reject the LLM&apos;s{' '}
                      <span className="text-white/85">assessment and explanation</span>.
                    </p>
                    {JUDGING_CRITERIA.map((criterion, index) => (
                      <div
                        key={`${criterion.title}-${index}`}
                        className={`rounded-xl border border-white/10 bg-[#091538] px-4 py-3 ${
                          index === JUDGING_CRITERIA.length - 1 ? 'mb-8' : ''
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <p className="text-sm font-semibold text-white/90">
                            {index + 1}. {criterion.title}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setCriterionStatus(
                                  currentReportIndex,
                                  criterion.metadataKey,
                                  'correct'
                                )
                              }
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                                currentCriterionFeedback[criterion.metadataKey]?.status ===
                                'correct'
                                  ? 'border border-[#86efac] bg-[#16a34a] text-white shadow-sm'
                                  : 'bg-[#0d1b46] text-white/80 hover:bg-[#12245a]'
                              }`}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setCriterionStatus(
                                  currentReportIndex,
                                  criterion.metadataKey,
                                  'incorrect'
                                )
                              }
                              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                                currentCriterionFeedback[criterion.metadataKey]?.status ===
                                'incorrect'
                                  ? 'bg-red-500/25 text-red-100 ring-1 ring-red-300'
                                  : 'bg-[#0d1b46] text-white/80 hover:bg-[#12245a]'
                              }`}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-white/75">
                          {formatJudgeExplanationValue(currentJudgeMetadata[criterion.explanationMetadataKey])}
                        </p>
                        {currentCriterionFeedback[criterion.metadataKey]?.status ===
                          'incorrect' && (
                          <textarea
                            rows={2}
                            value={
                              currentCriterionFeedback[criterion.metadataKey]?.correction || ''
                            }
                            onChange={event =>
                              setCriterionCorrection(
                                currentReportIndex,
                                criterion.metadataKey,
                                event.target.value
                              )
                            }
                            className="border-white/15 mt-3 min-h-[56px] w-full rounded-lg border bg-[#0d1b46] p-3 text-sm leading-relaxed text-white outline-none placeholder:text-white/40 focus:border-white/30"
                            placeholder="Describe why you reject this and provide the corrected assessment..."
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {remainingJudgeCriteriaCount > 0 && (
                    <div className="mt-4 border-t border-white/10 pt-3">
                      <p className="text-xs text-white/65">
                        Finish all 6 criteria to enable submit.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReportComparisonPanel;
