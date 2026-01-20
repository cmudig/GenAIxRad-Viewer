import React, { useEffect, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

import { auth, db } from '../../../platform/app/src/firebase';

const QUESTIONS = {
  q1: {
    id: 'q1',
    type: 'multiple-choice' as const,
    label: 'How accurate is the AI-generated report compared to the ground truth?',
    options: ['Highly accurate', 'Mostly accurate', 'Somewhat inaccurate', 'Highly inaccurate'],
  },
  q2: {
    id: 'q2',
    type: 'open-ended' as const,
    label: 'List any important findings that are missing or incorrect in the AI report.',
  },
  q3: {
    id: 'q3',
    type: 'open-ended' as const,
    label: 'Any additional notes on clarity, organization, or usefulness?',
  },
};

const ReportEvaluationPanel: React.FC = () => {
  const [currentReportIndex, setCurrentReportIndex] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [answers, setAnswers] = useState({ q1: '', q2: '', q3: '' });
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
    setAnswers({ q1: '', q2: '', q3: '' });
    setError('');
    setSuccessMessage('');
  }, [currentReportIndex]);

  const handleSubmit = async () => {
    if (!answers.q1) {
      setError('Please select an option for question 1.');
      return;
    }

    setError('');
    setSubmitting(true);

    try {
      const payload = {
        participants: {
          [participantId]: {
            [String(currentReportIndex)]: {
              q1: answers.q1,
              q2: answers.q2,
              q3: answers.q3,
              updatedAt: serverTimestamp(),
            },
          },
        },
      };

      await setDoc(doc(db, 'mammogram-study', 'participant-eval'), payload, { merge: true });
      if (totalReports > 0 && currentReportIndex >= totalReports - 1) {
        setSuccessMessage('Evaluation complete. You have reached the final case.');
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
            Evaluate the AI-generated report for the current case.
          </p>
        </div>
        <div className="ml-auto text-sm text-white/70">
          {totalReports > 0 ? `Case ${currentReportIndex + 1} of ${totalReports}` : 'Case 0 of 0'}
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
        <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
          <p className="text-sm font-semibold text-white/90">{QUESTIONS.q1.label}</p>
          <div className="mt-3 space-y-2">
            {QUESTIONS.q1.options.map(option => (
              <label key={option} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="report-q1"
                  value={option}
                  checked={answers.q1 === option}
                  onChange={() => setAnswers(prev => ({ ...prev, q1: option }))}
                  className="h-3 w-3 appearance-none rounded-full border border-white/50 bg-transparent checked:border-primary-light checked:bg-primary-light"
                />
                <span className="text-white/90">{option}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
          <p className="text-sm font-semibold text-white/90">{QUESTIONS.q2.label}</p>
          <textarea
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white/90 outline-none focus:border-white/40"
            rows={4}
            placeholder="Type your response..."
            value={answers.q2}
            onChange={e => setAnswers(prev => ({ ...prev, q2: e.target.value }))}
          />
        </div>

        <div className="rounded-2xl bg-[#0d1b46] p-4 shadow-inner shadow-black/30">
          <p className="text-sm font-semibold text-white/90">{QUESTIONS.q3.label}</p>
          <textarea
            className="mt-3 w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white/90 outline-none focus:border-white/40"
            rows={4}
            placeholder="Type your response..."
            value={answers.q3}
            onChange={e => setAnswers(prev => ({ ...prev, q3: e.target.value }))}
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
