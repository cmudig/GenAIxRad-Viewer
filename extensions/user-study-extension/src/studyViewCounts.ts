import { doc, increment, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db } from '../../../platform/app/src/firebase';

type StudyModeId = 'participant' | 'judge';

type RecordCompletedModeCaseInput = {
  participantId: string;
  participantCode?: string | null;
  modeId: StudyModeId;
  patientId: string;
  studyInstanceUID?: string | null;
};

const toSafeMapKey = (value: string): string => encodeURIComponent(value.trim()).replace(/\./g, '%2E');

export const recordCompletedModeCaseCount = async ({
  participantId,
  participantCode,
  modeId,
  patientId,
  studyInstanceUID,
}: RecordCompletedModeCaseInput): Promise<void> => {
  const normalizedParticipantId = participantId?.trim();
  const normalizedPatientId = patientId?.trim();
  const normalizedStudyInstanceUID = studyInstanceUID?.trim() || `patient:${normalizedPatientId}`;

  if (!normalizedParticipantId || !normalizedPatientId) {
    return;
  }

  const patientKey = toSafeMapKey(normalizedPatientId);
  const studyKey = toSafeMapKey(normalizedStudyInstanceUID);
  const countsDocRef = doc(db, 'mammogram-study', 'counts');
  const completionPath = ['participants', normalizedParticipantId, 'completedCases', modeId, studyKey];

  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(countsDocRef);
    const data = snapshot.data() || {};
    const existingCompletion = completionPath.reduce<any>((node, key) => node?.[key], data);

    // Idempotent guard: only count once per participant + mode + study.
    if (existingCompletion) {
      return;
    }

    const participantCounts: Record<string, any> = {
      participantCode: participantCode?.trim() || normalizedParticipantId,
      updatedAt: serverTimestamp(),
      modeTotals: {
        [modeId]: increment(1),
      },
      patientTotals: {
        [patientKey]: {
          patientId: normalizedPatientId,
          total: increment(1),
          modes: {
            [modeId]: increment(1),
          },
        },
      },
      completedCases: {
        [modeId]: {
          [studyKey]: serverTimestamp(),
        },
      },
    };

    const payload: Record<string, any> = {
      updatedAt: serverTimestamp(),
      modeTotals: {
        [modeId]: increment(1),
      },
      patientTotals: {
        [patientKey]: {
          patientId: normalizedPatientId,
          total: increment(1),
          modes: {
            [modeId]: increment(1),
          },
        },
      },
      participants: {
        [normalizedParticipantId]: participantCounts,
      },
    };

    transaction.set(countsDocRef, payload, { merge: true });
  });
};
