import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';

type StudyOption = {
  id: 'participant' | 'judge';
  title: string;
  subtitle: string;
  route: '/user-study-mode' | '/judge-mode';
  badgeClassName: string;
};

type Demographics = {
  participantCode: string;
  role: string;
  mammogramReviewExperienceYears: string;
  aiHealthcarePerspective: string;
};

type DicomWebStudy = {
  [tag: string]: {
    Value?: string[];
  };
};

type ModeProgress = {
  participantCode: string;
  modeId: StudyOption['id'];
  route: StudyOption['route'];
  targetCount: number;
  studyUIDs: string[];
  completedStudyUIDs: string[];
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
};

const STUDY_OPTIONS: StudyOption[] = [
  {
    id: 'participant',
    title: 'Participant Study',
    subtitle: 'Review two report drafts and choose which one reads better and is more accurate.',
    route: '/user-study-mode',
    badgeClassName:
      'border-[#3b82f6] bg-gradient-to-br from-[#102a64] to-[#0b1b45] hover:border-[#60a5fa] hover:shadow-[#3b82f6]/30',
  },
  {
    id: 'judge',
    title: 'Judge Mode',
    subtitle:
      'Compare a generated report with the reference report and mark where findings are correct or incorrect.',
    route: '/judge-mode',
    badgeClassName:
      'border-[#f59e0b] bg-gradient-to-br from-[#4a2a07] to-[#241405] hover:border-[#fbbf24] hover:shadow-[#f59e0b]/30',
  },
];

const STUDY_ENDPOINTS = ['/dicom-web/studies', '/pacs/dicom-web/studies', '/api/dicom-web/studies'];

const MODE_TARGET_CASES: Record<StudyOption['id'], number> = {
  participant: 8,
  judge: 5,
};

const getModeProgressKey = (participantCode: string, modeId: StudyOption['id']) =>
  `studyModeProgress:${participantCode}:${modeId}`;

const shuffle = <T,>(items: T[]) => {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const getNextStudyUID = (progress: ModeProgress): string | null => {
  const next = progress.studyUIDs.find(uid => !progress.completedStudyUIDs.includes(uid));
  return next || null;
};

const readModeProgress = (
  participantCode: string,
  modeId: StudyOption['id']
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

const extractStudyInstanceUID = (study: DicomWebStudy): string | null => {
  const tagUid = study?.['0020000D']?.Value?.[0];
  return tagUid ? String(tagUid) : null;
};

const fetchAvailableStudyUIDs = async (): Promise<string[]> => {
  for (const basePath of STUDY_ENDPOINTS) {
    try {
      const params = new URLSearchParams({
        limit: '50',
        offset: '0',
        fuzzymatching: 'false',
        includefield: '0020000D,00080020',
      });
      const response = await fetch(`${basePath}?${params.toString()}`);
      if (!response.ok) {
        continue;
      }

      const studies = (await response.json()) as DicomWebStudy[];
      if (!Array.isArray(studies)) {
        continue;
      }

      const uids = studies.map(extractStudyInstanceUID).filter((uid): uid is string => !!uid);
      if (uids.length) {
        return Array.from(new Set(uids));
      }
    } catch {
      // Try next base path.
    }
  }

  return [];
};

const SearchHomePage = () => {
  const navigate = useNavigate();
  const [demographics, setDemographics] = useState<Demographics>({
    participantCode: '',
    role: '',
    mammogramReviewExperienceYears: '',
    aiHealthcarePerspective: '',
  });
  const [demographicsSaved, setDemographicsSaved] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [isSubmittingDemographics, setIsSubmittingDemographics] = useState(false);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [modeCompletion, setModeCompletion] = useState<Record<StudyOption['id'], boolean>>({
    participant: false,
    judge: false,
  });

  const canSubmitDemographics = useMemo(() => {
    return (
      demographics.participantCode.trim() &&
      demographics.role.trim() &&
      demographics.mammogramReviewExperienceYears.trim() &&
      demographics.aiHealthcarePerspective.trim()
    );
  }, [demographics]);

  const refreshModeCompletion = (participantCode: string) => {
    if (!participantCode) {
      setModeCompletion({ participant: false, judge: false });
      return;
    }

    setModeCompletion({
      participant: !!readModeProgress(participantCode, 'participant')?.isComplete,
      judge: !!readModeProgress(participantCode, 'judge')?.isComplete,
    });
  };

  useEffect(() => {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('participantCode')?.trim() || '';
      const stored = window.sessionStorage.getItem('participantDemographics');
      const parsed = stored ? JSON.parse(stored) : null;

      if (parsed?.participantCode) {
        setDemographics({
          participantCode: parsed.participantCode,
          role: parsed.role || '',
          mammogramReviewExperienceYears: parsed.mammogramReviewExperienceYears || '',
          aiHealthcarePerspective: parsed.aiHealthcarePerspective || '',
        });
        setDemographicsSaved(true);
        refreshModeCompletion(parsed.participantCode);
      }

      if (fromQuery) {
        setDemographics(prev => ({ ...prev, participantCode: fromQuery }));
        const matchesStored = parsed?.participantCode === fromQuery;
        setDemographicsSaved(matchesStored);
        refreshModeCompletion(fromQuery);
      }
    } catch {
      // No-op if storage is unavailable.
    }
  }, []);

  const updateDemographicsField = (field: keyof Demographics, value: string) => {
    setDemographics(prev => ({ ...prev, [field]: value }));
    setDemographicsSaved(false);
    if (field === 'participantCode') {
      refreshModeCompletion(value.trim());
    }
  };

  const persistDemographics = async () => {
    if (!canSubmitDemographics) {
      setEntryError('Please fill out all demographic fields before selecting a study mode.');
      return;
    }

    setEntryError('');
    setIsSubmittingDemographics(true);

    try {
      const participantCode = demographics.participantCode.trim();
      const payload = {
        ...demographics,
        participantCode,
        uid: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
        createdAt: serverTimestamp(),
      };

      await setDoc(doc(db, 'participant-demographics', participantCode), payload, { merge: true });

      window.sessionStorage.setItem(
        'participantDemographics',
        JSON.stringify({
          ...demographics,
          participantCode,
          createdAt: new Date().toISOString(),
        })
      );

      setDemographicsSaved(true);
      refreshModeCompletion(participantCode);
    } catch (error) {
      console.error('SearchHomePage: failed to save participant demographics', error);
      setEntryError('Unable to save demographics right now. Please try again.');
    } finally {
      setIsSubmittingDemographics(false);
    }
  };

  const handleStudyEntry = async (studyOption: StudyOption) => {
    if (!demographicsSaved) {
      setEntryError('Save demographics first, then choose a study mode.');
      return;
    }

    setSelectedModeId(studyOption.id);
    setEntryError('');

    try {
      const studyUIDs = await fetchAvailableStudyUIDs();
      if (!studyUIDs.length) {
        setEntryError('No available studies were found. Please verify your Orthanc data source.');
        return;
      }

      const participantCode = demographics.participantCode.trim();
      const existingProgress = readModeProgress(participantCode, studyOption.id);
      let progress: ModeProgress;

      if (existingProgress) {
        progress = existingProgress;
      } else {
        const targetCount = Math.min(MODE_TARGET_CASES[studyOption.id], studyUIDs.length);
        progress = {
          participantCode,
          modeId: studyOption.id,
          route: studyOption.route,
          targetCount,
          studyUIDs: shuffle(studyUIDs).slice(0, targetCount),
          completedStudyUIDs: [],
          isComplete: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      if (progress.isComplete) {
        refreshModeCompletion(participantCode);
        setEntryError(`${studyOption.title} is already complete for participant ${participantCode}.`);
        return;
      }

      const nextStudyUID = getNextStudyUID(progress);
      if (!nextStudyUID) {
        const completedProgress: ModeProgress = {
          ...progress,
          isComplete: true,
          updatedAt: new Date().toISOString(),
        };
        writeModeProgress(completedProgress);
        refreshModeCompletion(participantCode);
        setEntryError(`${studyOption.title} is complete for participant ${participantCode}.`);
        return;
      }

      writeModeProgress({ ...progress, updatedAt: new Date().toISOString() });
      navigate(
        `${studyOption.route}?StudyInstanceUIDs=${encodeURIComponent(
          nextStudyUID
        )}&participantCode=${encodeURIComponent(participantCode)}`
      );
    } catch (error) {
      console.error('SearchHomePage: failed to enter study mode', error);
      setEntryError('Could not launch study mode right now. Please try again.');
    } finally {
      setSelectedModeId(null);
    }
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e3a8a_0%,#0b1025_45%,#050816_100%)] px-6 py-10 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 rounded-2xl border border-white/15 bg-[#091534]/80 p-6 shadow-xl shadow-black/30">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#93c5fd]">User Study Entry</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-white">Radiology Study Launcher</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/80">
            Complete participant demographics, then select a mode option to enter either Participant
            Study or Judge Mode.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
          <section className="rounded-2xl border border-white/15 bg-[#0a1738]/85 p-6 shadow-lg shadow-black/30">
            <h2 className="text-lg font-bold text-white">Participant Demographics</h2>
            <p className="mt-1 text-sm text-white/75">All fields are required before mode selection.</p>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-white/90">Participant Code</span>
                <input
                  type="text"
                  value={demographics.participantCode}
                  onChange={event => updateDemographicsField('participantCode', event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/20 bg-[#07112b] px-3 py-2 text-sm text-white outline-none focus:border-[#60a5fa]"
                  placeholder="e.g., UPMC-001"
                />
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-white/90">Clinical Role</span>
                <select
                  value={demographics.role}
                  onChange={event => updateDemographicsField('role', event.target.value)}
                  className="mt-2 w-full rounded-xl border border-white/20 bg-[#07112b] px-3 py-2 text-sm text-white outline-none focus:border-[#60a5fa]"
                >
                  <option value="">Select role</option>
                  <option value="radiologist">Radiologist</option>
                  <option value="resident">Resident/Fellow</option>
                  <option value="student">Student</option>
                  <option value="other">Other</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-white/90">
                  Years of Experience Reviewing Mammograms
                </span>
                <select
                  value={demographics.mammogramReviewExperienceYears}
                  onChange={event =>
                    updateDemographicsField('mammogramReviewExperienceYears', event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-white/20 bg-[#07112b] px-3 py-2 text-sm text-white outline-none focus:border-[#60a5fa]"
                >
                  <option value="">Select years</option>
                  <option value="0-2 years">0-2 years</option>
                  <option value="3-5 years">3-5 years</option>
                  <option value="6-10 years">6-10 years</option>
                  <option value="10+ years">10+ years</option>
                </select>
              </label>

              <label className="block">
                <span className="text-sm font-semibold text-white/90">
                  Perspective Towards AI Assistance in Healthcare
                </span>
                <select
                  value={demographics.aiHealthcarePerspective}
                  onChange={event =>
                    updateDemographicsField('aiHealthcarePerspective', event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-white/20 bg-[#07112b] px-3 py-2 text-sm text-white outline-none focus:border-[#60a5fa]"
                >
                  <option value="">Select one</option>
                  <option value="very-positive">Very positive</option>
                  <option value="somewhat-positive">Somewhat positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="somewhat-negative">Somewhat negative</option>
                  <option value="very-negative">Very negative</option>
                </select>
              </label>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={persistDemographics}
                disabled={!canSubmitDemographics || isSubmittingDemographics || demographicsSaved}
                className={`rounded-full px-5 py-2 text-sm font-bold transition-colors ${
                  demographicsSaved
                    ? 'cursor-default bg-emerald-600 text-white'
                    : !canSubmitDemographics || isSubmittingDemographics
                      ? 'cursor-not-allowed bg-white/15 text-white/50'
                      : 'bg-[#60a5fa] text-black hover:bg-[#93c5fd]'
                }`}
              >
                {demographicsSaved
                  ? 'Demographics Saved'
                  : isSubmittingDemographics
                    ? 'Saving...'
                    : 'Save Demographics'}
              </button>
              {demographicsSaved && (
                <span className="text-xs font-semibold text-emerald-300">Ready to select a study mode.</span>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-white/15 bg-[#0a1738]/85 p-6 shadow-lg shadow-black/30">
            <h2 className="text-lg font-bold text-white">Select Study Mode</h2>
            <p className="mt-1 text-sm text-white/75">
              Click a mode option to enter the selected mode with the next available study.
            </p>

            <div className="mt-5 grid gap-4">
              {STUDY_OPTIONS.map(option => {
                const isLoading = selectedModeId === option.id;
                const isComplete = modeCompletion[option.id];
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleStudyEntry(option)}
                    disabled={!demographicsSaved || !!selectedModeId || isComplete}
                    className={`w-full rounded-2xl border p-5 text-left shadow-md transition-all ${option.badgeClassName} ${
                      !demographicsSaved || (!!selectedModeId && !isLoading) || isComplete
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:-translate-y-0.5 hover:shadow-xl'
                    }`}
                  >
                    <p className="text-xs font-black uppercase tracking-[0.16em] text-white/70">Mode Option</p>
                    <p className="mt-2 text-xl font-black text-white">{option.title}</p>
                    <p className="mt-2 text-sm text-white/80">{option.subtitle}</p>
                    <p className="mt-4 text-xs font-semibold text-white/70">
                      {isComplete
                        ? 'Complete'
                        : isLoading
                          ? 'Opening selected study...'
                          : 'Click to launch'}
                    </p>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {entryError && (
          <div className="mt-6 rounded-xl border border-red-300/40 bg-red-500/20 p-3 text-sm text-red-100">
            {entryError}
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchHomePage;
