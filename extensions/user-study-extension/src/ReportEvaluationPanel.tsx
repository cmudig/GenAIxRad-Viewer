import React, { useEffect, useState } from 'react';
import { FieldPath, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';

import { auth, db } from '../../../platform/app/src/firebase';
import {
  getMetadataFromStudyByKeys,
  getPatientIdFromStudyInstanceUid,
} from '../../../platform/app/src/components/dicom_helpers';

const QUESTIONS = [
  {
    id: 'overallPreference',
    type: 'multiple-choice' as const,
    label: 'Which report do you prefer overall?',
    options: ['(A)', '(B)'],
  },
  {
    id: 'radiologicAccuracy',
    type: 'multiple-choice' as const,
    label: 'Which report is a more radiologically accurate representation of this mammogram?',
    options: ['(A)', '(B)'],
  },
  {
    id: 'usefulness',
    type: 'multiple-choice' as const,
    label: 'Which report is more useful for clinical decision-making?',
    options: ['(A)', '(B)'],
  },
];

type QuestionId = (typeof QUESTIONS)[number]['id'];
type Responses = Partial<Record<QuestionId, string>>;

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

const getCurrentStudyUIDFromUrl = (): string | null => {
  try {
    const params = new URLSearchParams(window.location.search);
    const firstFromGetAll = params.getAll('StudyInstanceUIDs')?.[0];
    const studyUid = firstFromGetAll ?? params.get('StudyInstanceUIDs');
    return studyUid && studyUid.trim() ? studyUid.trim() : null;
  } catch {
    return null;
  }
};

const getReviewedStudyParticipantId = async (studyInstanceUID: string | null): Promise<string | null> => {
  if (!studyInstanceUID) {
    return null;
  }

  const patientIdFromDicom = await getPatientIdFromStudyInstanceUid(studyInstanceUID);
  if (patientIdFromDicom) {
    return patientIdFromDicom;
  }

  const metadataKeys = ['participantID', 'participantId', 'participant_id'];
  const value = await getMetadataFromStudyByKeys(studyInstanceUID, metadataKeys);
  const normalized = value?.trim();
  return normalized || null;
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

const ReportEvaluationPanel: React.FC<{ servicesManager?: any }> = ({ servicesManager }) => {
  const { uiNotificationService } = servicesManager?.services ?? {};
  const navigate = useNavigate();
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [responses, setResponses] = useState<Responses>({});
  const [overallComment, setOverallComment] = useState('');
  const participantId = getParticipantCodeFromContext() || auth.currentUser?.uid || 'anonymous';

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail || {};
      if (typeof detail.index === 'number') {
        setCurrentReportIndex(detail.index);
      }
      if (typeof detail.total === 'number') {
        setTotalReports(detail.total);
      }
    };

    document.addEventListener('reportIndexChanged', handler);
    return () => document.removeEventListener('reportIndexChanged', handler);
  }, []);

  useEffect(() => {
    setResponses({});
    setOverallComment('');
    setError('');
    setSuccessMessage('');
  }, [currentReportIndex]);

  const handleSubmit = async () => {
    const unansweredQuestions = QUESTIONS.filter(question => !responses[question.id]);
    if (unansweredQuestions.length > 0) {
      setError('Please answer all questions before submitting.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const showEvaluationSavedNotification = () => {
        uiNotificationService?.show?.({
          title: 'Comparison Evaluation Submitted',
          message: 'Your report-comparison evaluation has been saved.',
          type: 'success',
          duration: 2800,
        });
      };

      const currentStudyUID = getCurrentStudyUIDFromUrl();
      const reviewedStudyParticipantId = await getReviewedStudyParticipantId(currentStudyUID);
      const demographics = getParticipantDemographicsFromSession();
      const comparisonKey = currentStudyUID || `case-${currentReportIndex}`;

      const comparisonPayload = {
        participantCode: getParticipantCodeFromContext(),
        reviewedStudyParticipantId,
        reviewedStudyInstanceUID: currentStudyUID,
        overallComment: overallComment.trim(),
        evaluationResponses: responses,
        updatedAt: serverTimestamp(),
      };

      const evalDocRef = doc(db, 'mammogram-study', 'participant-eval');
      try {
        const updates: any[] = [
          new FieldPath('participants', participantId, 'comparison', comparisonKey),
          comparisonPayload,
        ];
        if (demographics) {
          updates.push(new FieldPath('participants', participantId, 'demographics'), demographics);
        }
        await updateDoc(evalDocRef, ...updates);
      } catch (updateError: any) {
        // If the document does not exist yet, create it with merge as fallback.
        if (updateError?.code === 'not-found') {
          const payload = {
            participants: {
              [participantId]: {
                demographics: demographics || null,
                comparison: {
                  [comparisonKey]: comparisonPayload,
                },
              },
            },
          };
          await setDoc(evalDocRef, payload, { merge: true });
        } else {
          throw updateError;
        }
      }
      const participantCode = getParticipantCodeFromContext();
      const progress = participantCode ? readModeProgress(participantCode, 'participant') : null;

      if (!participantCode || !progress) {
        showEvaluationSavedNotification();
        document.dispatchEvent(
          new CustomEvent('reportAdvance', {
            detail: { delta: 1 },
          })
        );
        return;
      }

      const completedSet = new Set(progress.completedStudyUIDs);
      if (currentStudyUID) {
        completedSet.add(currentStudyUID);
      }

      const completedStudyUIDs = Array.from(completedSet);
      const isComplete = completedStudyUIDs.length >= progress.targetCount;
      const nextStudyUID = progress.studyUIDs.find(uid => !completedSet.has(uid)) || null;

      const nextProgress: ModeProgress = {
        ...progress,
        completedStudyUIDs,
        isComplete: isComplete || !nextStudyUID,
        updatedAt: new Date().toISOString(),
      };
      writeModeProgress(nextProgress);

      if (nextProgress.isComplete) {
        showEvaluationSavedNotification();
        setSuccessMessage('Evaluation complete. Returning to study launcher...');
        navigate(`/?participantCode=${encodeURIComponent(participantCode)}`);
        return;
      }

      if (nextStudyUID) {
        showEvaluationSavedNotification();
        navigate(
          `/user-study-mode?StudyInstanceUIDs=${encodeURIComponent(
            nextStudyUID
          )}&participantCode=${encodeURIComponent(participantCode)}`
        );
        return;
      }

      showEvaluationSavedNotification();
      navigate(`/?participantCode=${encodeURIComponent(participantCode)}`);
    } catch (submitError) {
      console.error('ReportEvaluationPanel: failed to save responses', submitError);
      setError('Unable to save responses. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="shadow-primary-main/10 flex h-full flex-col rounded-2xl bg-[#050c24] p-4 text-white shadow-lg">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="text-base font-semibold">Report Evaluation</p>
          <p className="text-sm text-white/80">
            Compare the two reports and answer all evaluation questions for the current case.
          </p>
        </div>
        <div className="ml-auto text-sm text-white/70">
          {totalReports > 0 ? `Case ${currentReportIndex + 1} of ${totalReports}` : 'Case 1 of 1'}
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#42182c] p-3 text-xs text-white/80">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="mt-3 rounded-xl border border-white/10 bg-[#0b1639] p-3 text-xs text-white/80">
          {successMessage}
        </div>
      )}

      <div className="ohif-scrollbar mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
        {QUESTIONS.map(question => (
          <div
            key={question.id}
            className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30"
          >
            <p className="text-sm font-semibold text-white/90">{question.label}</p>
            <div className="mt-3 space-y-2">
              {question.options.map(option => (
                <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`report-eval-${question.id}`}
                    value={option}
                    checked={responses[question.id] === option}
                    onChange={() =>
                      setResponses(prev => ({
                        ...prev,
                        [question.id]: option,
                      }))
                    }
                    className="h-3 w-3 appearance-none rounded-full border border-white/50 bg-transparent checked:border-primary-light checked:bg-primary-light"
                  />
                  <span className="text-white/90">{option}</span>
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
          <p className="text-sm font-semibold text-white/90">
            Additional comments (optional)
          </p>
          <p className="mt-1 text-xs text-white/70">
            Share any reasoning, concerns, or observations about this comparison.
          </p>
          <textarea
            value={overallComment}
            onChange={event => setOverallComment(event.target.value)}
            rows={4}
            className="border-white/20 mt-3 w-full rounded-xl border bg-[#07112b] p-3 text-sm text-white outline-none placeholder:text-white/45 focus:border-[#60a5fa]"
            placeholder="Optional: add your comments here..."
          />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
            submitting
              ? 'cursor-not-allowed bg-white/10 text-white/40'
              : 'bg-primary-light text-black hover:bg-white'
          }`}
        >
          {submitting ? 'Saving…' : 'Submit Evaluation'}
        </button>
        <span className="text-xs text-white/60">Saved under participant: {participantId}</span>
      </div>
    </div>
  );
};

export default ReportEvaluationPanel;
