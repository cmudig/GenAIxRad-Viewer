import React, { useEffect, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

import { auth, db } from '../../../platform/app/src/firebase';

const QUESTIONS = [
  {
    id: 'preference',
    type: 'multiple-choice' as const,
    label: 'Which AI-generated report do you prefer?',
    options: ['(A)', '(B)'],
  },
  {
    id: 'clinicalAccuracy',
    type: 'multiple-choice' as const,
    label: 'Which AI-generated report is more clinically accurate?',
    options: ['(A)', '(B)'],
  },
  {
    id: 'structureAlignment',
    type: 'multiple-choice' as const,
    label: 'Which AI-generated report is more aligned with existing report structures?',
    options: ['(A)', '(B)'],
  },
];

type QuestionId = (typeof QUESTIONS)[number]['id'];
type Responses = Partial<Record<QuestionId, string>>;

const ReportEvaluationPanel: React.FC = () => {
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [responses, setResponses] = useState<Responses>({});
  const participantId = auth.currentUser?.uid || 'anonymous';

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
      const payload = {
        participants: {
          [participantId]: {
            [String(currentReportIndex)]: {
              preferredReport: responses.preference,
              clinicallyAccurateReport: responses.clinicalAccuracy,
              structureAlignedReport: responses.structureAlignment,
              updatedAt: serverTimestamp(),
            },
          },
        },
      };

      await setDoc(doc(db, 'mammogram-study', 'participant-eval'), payload, { merge: true });
      if (totalReports > 0 && currentReportIndex >= totalReports - 1) {
        setSuccessMessage('Evaluation complete. You have reached the final case.');
        window.sessionStorage.setItem('reportComparisonPhase', 'aiPair');
        document.dispatchEvent(
          new CustomEvent('reportComparisonPhaseChange', {
            detail: { phase: 'aiPair' },
          })
        );
      } else {
        document.dispatchEvent(
          new CustomEvent('reportAdvance', {
            detail: { delta: 1 },
          })
        );
      }
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
