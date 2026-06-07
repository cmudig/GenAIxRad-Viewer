import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
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

type AvailableStudy = {
  studyInstanceUID: string;
  patientID: string | null;
  studyDate: string | null;
  modalitiesInStudy: string[];
  numberOfStudyRelatedInstances: number;
};

type GroupConfig = {
  key: string;
  aliases: string[];
};

type ParticipantGroups = Record<string, Array<string | number>>;
type CountsDocData = {
  patientTotals?: Record<
    string,
    {
      patientId?: string;
      modes?: Record<'participant' | 'judge', number>;
    }
  >;
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
    id: 'judge',
    title: 'Report Evaluation Mode',
    subtitle:
      'Compare a candidate report with the reference report and mark where findings are correct or incorrect.',
    route: '/judge-mode',
    badgeClassName:
      'border-[#f59e0b] bg-gradient-to-br from-[#4a2a07] to-[#241405] hover:border-[#fbbf24] hover:shadow-[#f59e0b]/30',
  },
  // The Report Comparison Mode button is intentionally hidden from the homepage.
  // {
  //   id: 'participant',
  //   title: 'Report Comparison Mode',
  //   subtitle:
  //     'After Report Evaluation Mode, review two report drafts and choose which reads better and is more accurate.',
  //   route: '/user-study-mode',
  //   badgeClassName:
  //     'border-[#3b82f6] bg-gradient-to-br from-[#102a64] to-[#0b1b45] hover:border-[#60a5fa] hover:shadow-[#3b82f6]/30',
  // },
];

const JUDGE_MODE_PRELAUNCH_INSTRUCTIONS = [
  "In this study, you will help evaluate whether an LLM-based judge correctly assesses the clinical agreement between a Mammo-FM-generated mammography report and the corresponding ground-truth radiology report. For each case, you will be shown both reports, the evaluation criteria, and the LLM judge’s reasoning for each criterion. Each reasoning statement describes whether the generated report contains a clinically relevant agreement or error compared with the ground-truth report, such as a missing finding, an incorrectly reported finding, mischaracterization of a finding, incorrect location or laterality, or an incorrect BI-RADS assessment.",
  "Your task is to independently review each reasoning statement in the context of the two reports and indicate whether you agree with it. Select Accept if the LLM’s reasoning is clinically correct based on the generated and ground-truth reports. Select Reject if the reasoning is incorrect, incomplete, or not supported by the reports. Please evaluate each criterion separately and base your judgment only on the information presented in the two reports.",
];

const PARTICIPANT_MODE_PRELAUNCH_INSTRUCTIONS = [
  'In this mode, you will compare two candidate mammography reports (Report A and Report B) for the same case.',
  "Review both reports alongside the mammogram images, then answer each comparison question by selecting either (A) or (B). Focus on which report is better overall, more radiologically accurate, and more useful for clinical decision-making.",
  'Evaluate each case independently and base your responses only on the reports and images shown for that case.',
];

const JUDGE_MODE_CRITERIA = [
  'False report of a finding: the candidate report mentions a finding (e.g., a mass, calcification, asymmetry) that is not in the ground truth report.',
  'Missing a finding: The candidate report omits a finding mentioned in the ground truth report.',
  'Mischaracterization of a finding: A finding is present in both the ground truth and candidate report, but its characteristics (e.g., size, margins, stability/interval change) are described incorrectly.',
  'Misidentification of location/laterality: A finding is correctly identified, but its location (e.g., "upper outer quadrant", retroareolar, depth) or laterality (left/right/bilateral) is wrong.',
  'Incorrect BI-RADS score.',
  'Breast density mismatch.',
];

// Keep this aligned with the viewer's default Orthanc data source (/api/dicom-web)
// so assignment and viewport loading target the same backend path.
const STUDY_ENDPOINTS = ['/api/dicom-web/studies', '/pacs/dicom-web/studies', '/dicom-web/studies'];

const PARTICIPANT_GROUPS_ENDPOINTS = ['/participant_id_groups.json', '/patient_id_groups.json'];

const REQUIRED_GROUPS: GroupConfig[] = [
  { key: 'asymetry', aliases: ['asymetry', 'asymmetry'] },
  { key: 'calcification', aliases: ['calcification'] },
  { key: 'mass', aliases: ['mass'] },
  { key: 'no-findings', aliases: ['no-findings', 'no_findings', 'no findings'] },
];
const MAMMO_MODALITIES = ['MG', 'DX', 'CR'];
const FAST_STUDY_MAX_INSTANCES = 24;
const VERY_HEAVY_STUDY_MAX_INSTANCES = 120;

const MODE_GROUP_TARGET_CASES: Record<StudyOption['id'], number> = {
  participant: 1,
  judge: 2,
};

const getModeProgressKey = (participantCode: string, modeId: StudyOption['id']) =>
  `studyModeProgress:${participantCode}:${modeId}`;

const generateParticipantCode = (): string => {
  const max = 1_000_000;
  let randomNumber = Math.floor(Math.random() * max);

  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    randomNumber = values[0] % max;
  }

  return `PID_${String(randomNumber).padStart(6, '0')}`;
};

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

const extractPatientID = (study: DicomWebStudy): string | null => {
  const tagPatientId = study?.['00100020']?.Value?.[0];
  return tagPatientId ? String(tagPatientId).trim() : null;
};

const extractStudyDate = (study: DicomWebStudy): string | null => {
  const tagStudyDate = study?.['00080020']?.Value?.[0];
  return tagStudyDate ? String(tagStudyDate).trim() : null;
};

const extractModalitiesInStudy = (study: DicomWebStudy): string[] => {
  const values = study?.['00080061']?.Value;
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map(v => String(v).trim().toUpperCase()).filter(Boolean);
};

const extractNumberOfStudyRelatedInstances = (study: DicomWebStudy): number => {
  const raw = study?.['00201208']?.Value?.[0];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};


const isLikelyFastMammoStudy = (study: AvailableStudy): boolean => {
  const hasMammoLikeModality = study.modalitiesInStudy.some(modality =>
    MAMMO_MODALITIES.includes(modality)
  );
  const relatedInstances = Number(study.numberOfStudyRelatedInstances || 0);
  return hasMammoLikeModality && relatedInstances > 0 && relatedInstances <= FAST_STUDY_MAX_INSTANCES;
};

const sortStudiesByLoadSpeed = (a: AvailableStudy, b: AvailableStudy): number => {
  if (a.numberOfStudyRelatedInstances !== b.numberOfStudyRelatedInstances) {
    return a.numberOfStudyRelatedInstances - b.numberOfStudyRelatedInstances;
  }

  const aDate = a.studyDate || '';
  const bDate = b.studyDate || '';
  return bDate.localeCompare(aDate);
};

const fetchParticipantGroups = async (): Promise<ParticipantGroups> => {
  for (const endpoint of PARTICIPANT_GROUPS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, { cache: 'no-store' });
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as ParticipantGroups;
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return payload;
      }
    } catch {
      // Try next endpoint.
    }
  }

  throw new Error(
    'Could not load participant groups file. Expected /participant_id_groups.json in platform/app/public.'
  );
};

const fetchAvailableStudies = async (): Promise<AvailableStudy[]> => {
  const pageLimit = 200;

  for (const basePath of STUDY_ENDPOINTS) {
    try {
      const studyMap = new Map<string, AvailableStudy>();
      let offset = 0;

      while (true) {
        const params = new URLSearchParams({
          limit: String(pageLimit),
          offset: String(offset),
          fuzzymatching: 'false',
          includefield: '0020000D,00100020,00080020,00080061,00201208',
        });
        const response = await fetch(`${basePath}?${params.toString()}`);
        if (!response.ok) {
          break;
        }

        const studies = (await response.json()) as DicomWebStudy[];
        if (!Array.isArray(studies) || studies.length === 0) {
          break;
        }

        for (const study of studies) {
          const studyInstanceUID = extractStudyInstanceUID(study);
          if (!studyInstanceUID) {
            continue;
          }
          studyMap.set(studyInstanceUID, {
            studyInstanceUID,
            patientID: extractPatientID(study),
            studyDate: extractStudyDate(study),
            modalitiesInStudy: extractModalitiesInStudy(study),
            numberOfStudyRelatedInstances: extractNumberOfStudyRelatedInstances(study),
          });
        }

        if (studies.length < pageLimit) {
          break;
        }

        offset += pageLimit;
      }

      if (studyMap.size) {
        return Array.from(studyMap.values());
      }
    } catch {
      // Try next base path.
    }
  }

  return [];
};

const fetchModePatientCounts = async (
  modeId: StudyOption['id']
): Promise<Map<string, number>> => {
  const countsRef = doc(db, 'mammogram-study', 'counts');
  const countsSnap = await getDoc(countsRef);
  if (!countsSnap.exists()) {
    return new Map<string, number>();
  }

  const data = countsSnap.data() as CountsDocData;
  const patientTotals = data?.patientTotals || {};
  const result = new Map<string, number>();

  for (const entry of Object.values(patientTotals)) {
    const patientId = entry?.patientId ? String(entry.patientId).trim() : '';
    if (!patientId) {
      continue;
    }

    const modeCount = Number(entry?.modes?.[modeId] || 0);
    result.set(patientId, Number.isFinite(modeCount) ? modeCount : 0);
  }

  return result;
};

const orderPatientIdsByModeCounts = (
  patientIds: string[],
  modeCounts: Map<string, number>
): string[] => {
  return [...patientIds]
    .map(patientId => ({ patientId, count: modeCounts.get(patientId) ?? 0, tieBreaker: Math.random() }))
    .sort((a, b) => {
      if (a.count !== b.count) {
        return a.count - b.count;
      }
      return a.tieBreaker - b.tieBreaker;
    })
    .map(item => item.patientId);
};

const getGroupPatientIds = (groups: ParticipantGroups, config: GroupConfig): string[] => {
  const matchedKey = config.aliases.find(alias => Array.isArray(groups[alias]));
  if (!matchedKey) {
    return [];
  }

  const rawValues = groups[matchedKey] || [];
  return rawValues.map(value => String(value).trim()).filter(Boolean);
};

const assignStudyUIDsForMode = ({
  modeId,
  availableStudies,
  participantGroups,
  modePatientCounts,
}: {
  modeId: StudyOption['id'];
  availableStudies: AvailableStudy[];
  participantGroups: ParticipantGroups;
  modePatientCounts: Map<string, number>;
}): string[] => {
  const perGroupCount = MODE_GROUP_TARGET_CASES[modeId];
  const neededTotal = REQUIRED_GROUPS.length * perGroupCount;

  const studiesByPatientId = new Map<string, AvailableStudy[]>();
  for (const study of availableStudies) {
    if (!study.patientID) {
      continue;
    }

    const patientId = study.patientID;
    if (!studiesByPatientId.has(patientId)) {
      studiesByPatientId.set(patientId, []);
    }
    studiesByPatientId.get(patientId)!.push(study);
  }

  const selectedStudyUIDs: string[] = [];
  const selectedSet = new Set<string>();
  const selectedPatientIds = new Set<string>();
  const selectedCases: Array<{ group: string; patientId: string; studyInstanceUID: string }> = [];
  const missingGroups: string[] = [];

  for (const group of REQUIRED_GROUPS) {
    const groupPatientIds = orderPatientIdsByModeCounts(
      getGroupPatientIds(participantGroups, group),
      modePatientCounts
    );
    let selectedForGroup = 0;

    for (const patientId of groupPatientIds) {
      if (selectedPatientIds.has(patientId)) {
        continue;
      }
      const patientStudies = shuffle(studiesByPatientId.get(patientId) || []).filter(study => {
        const hasInstances = study.numberOfStudyRelatedInstances > 0;
        const hasMammoLikeModality = study.modalitiesInStudy.some(modality =>
          MAMMO_MODALITIES.includes(modality)
        );
        return hasInstances && hasMammoLikeModality;
      });

      // Prefer light studies for user-study throughput, but gracefully fall back to
      // larger studies when necessary.
      const fastCandidateStudies = patientStudies.filter(isLikelyFastMammoStudy).sort(sortStudiesByLoadSpeed);
      const fallbackCandidateStudies = patientStudies.sort(sortStudiesByLoadSpeed);
      const orderedCandidateStudies = fastCandidateStudies.length
        ? fastCandidateStudies
        : fallbackCandidateStudies;

      const nextStudy = orderedCandidateStudies.find(study => !selectedSet.has(study.studyInstanceUID));
      const nextStudyUID = nextStudy?.studyInstanceUID || null;

      if (!nextStudyUID) {
        continue;
      }

      selectedSet.add(nextStudyUID);
      selectedPatientIds.add(patientId);
      selectedStudyUIDs.push(nextStudyUID);
      selectedCases.push({
        group: group.key,
        patientId,
        studyInstanceUID: nextStudyUID,
      });
      selectedForGroup += 1;

      if (selectedForGroup >= perGroupCount) {
        break;
      }
    }

    if (selectedForGroup < perGroupCount) {
      missingGroups.push(`${group.key} (${selectedForGroup}/${perGroupCount})`);
    }
  }

  if (missingGroups.length || selectedStudyUIDs.length < neededTotal) {
    throw new Error(
      `Not enough grouped studies for ${modeId} mode. Missing: ${missingGroups.join(
        ', '
      )}. Check participant_id_groups.json and Orthanc availability. Selected unique patients: ${
        selectedPatientIds.size
      }/${neededTotal}.`
    );
  }

  console.info(`[StudyAssignment:${modeId}] Assigned cases`, selectedCases);

  return selectedStudyUIDs.slice(0, neededTotal);
};

const SearchHomePage = () => {
  const navigate = useNavigate();
  const quickTestParamEnabled = useMemo(() => {
    try {
      const value = new URLSearchParams(window.location.search).get('quickTest');
      return value === '1' || value === 'true';
    } catch {
      return false;
    }
  }, []);
  const canUseQuickTestBypass = useMemo(() => {
    const hostname = window.location.hostname.toLowerCase();
    return (
      quickTestParamEnabled || hostname === 'localhost' || hostname === '127.0.0.1'
    );
  }, [quickTestParamEnabled]);
  const [demographics, setDemographics] = useState<Demographics>({
    participantCode: generateParticipantCode(),
    role: '',
    mammogramReviewExperienceYears: '',
    aiHealthcarePerspective: '',
  });
  const [demographicsSaved, setDemographicsSaved] = useState(false);
  const [entryError, setEntryError] = useState('');
  const [isSubmittingDemographics, setIsSubmittingDemographics] = useState(false);
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null);
  const [isLaunchingStudy, setIsLaunchingStudy] = useState(false);
  const [pendingLaunchUrl, setPendingLaunchUrl] = useState<string | null>(null);
  const [modeLaunchNextClicked, setModeLaunchNextClicked] = useState(false);
  const [modeCompletion, setModeCompletion] = useState<Record<StudyOption['id'], boolean>>({
    participant: false,
    judge: false,
  });
  const [comparisonQuickTestBypass, setComparisonQuickTestBypass] = useState(
    quickTestParamEnabled
  );

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

  const clearLaunchState = useCallback(() => {
    setSelectedModeId(null);
    setIsLaunchingStudy(false);
    setPendingLaunchUrl(null);
    setModeLaunchNextClicked(false);
  }, []);

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

  useEffect(() => {
    if (!selectedModeId) {
      return;
    }

    if (!modeLaunchNextClicked) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      clearLaunchState();
      setEntryError(
        'Launching study is taking longer than expected. Please try again.'
      );
    }, 45000);

    return () => window.clearTimeout(timeoutId);
  }, [clearLaunchState, selectedModeId, modeLaunchNextClicked]);

  useEffect(() => {
    if (!selectedModeId || !pendingLaunchUrl) {
      return;
    }

    if (!modeLaunchNextClicked) {
      return;
    }

    setIsLaunchingStudy(true);
    navigate(pendingLaunchUrl);
  }, [modeLaunchNextClicked, navigate, pendingLaunchUrl, selectedModeId]);

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
      let participantCode = demographics.participantCode.trim() || generateParticipantCode();
      let demographicsDocRef = doc(db, 'participant-demographics', participantCode);
      let isReturningParticipant = false;

      try {
        const stored = window.sessionStorage.getItem('participantDemographics');
        const parsed = stored ? JSON.parse(stored) : null;
        const fromQuery =
          new URLSearchParams(window.location.search).get('participantCode')?.trim() || '';
        isReturningParticipant =
          parsed?.participantCode === participantCode || fromQuery === participantCode;
      } catch {
        isReturningParticipant = false;
      }

      if (!isReturningParticipant) {
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const existingDemographics = await getDoc(demographicsDocRef);
          if (!existingDemographics.exists()) {
            break;
          }

          participantCode = generateParticipantCode();
          demographicsDocRef = doc(db, 'participant-demographics', participantCode);
        }
      }

      const payload = {
        ...demographics,
        participantCode,
        uid: auth.currentUser?.uid || null,
        email: auth.currentUser?.email || null,
        createdAt: serverTimestamp(),
      };

      await setDoc(demographicsDocRef, payload, { merge: true });
      setDemographics(prev => ({ ...prev, participantCode }));

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

    setEntryError('');
    setSelectedModeId(studyOption.id);
    setPendingLaunchUrl(null);
    setModeLaunchNextClicked(false);
    setIsLaunchingStudy(false);

    try {
      const comparisonModeLocked = studyOption.id === 'participant' && !modeCompletion.judge;
      if (comparisonModeLocked && !comparisonQuickTestBypass) {
        setEntryError('Complete Report Evaluation Mode first to unlock Report Comparison Mode.');
        clearLaunchState();
        return;
      }

      const [availableStudies, participantGroups, modePatientCounts] = await Promise.all([
        fetchAvailableStudies(),
        fetchParticipantGroups(),
        fetchModePatientCounts(studyOption.id),
      ]);

      if (!availableStudies.length) {
        setEntryError('No available studies were found. Please verify your Orthanc data source.');
        clearLaunchState();
        return;
      }

      const participantCode = demographics.participantCode.trim();
      const existingProgress = readModeProgress(participantCode, studyOption.id);
      let progress: ModeProgress;
      const patientIdByStudyUID = new Map(
        availableStudies.map(study => [study.studyInstanceUID, study.patientID || 'unknown'])
      );

      const expectedTargetCount = REQUIRED_GROUPS.length * MODE_GROUP_TARGET_CASES[studyOption.id];
      const existingPatientIds = (existingProgress?.studyUIDs || []).map(
        uid => patientIdByStudyUID.get(uid) || 'unknown'
      );
      const availableStudyByUID = new Map(
        availableStudies.map(study => [study.studyInstanceUID, study])
      );
      const hasVeryHeavyStudiesInExistingProgress = (existingProgress?.studyUIDs || []).some(uid => {
        const study = availableStudyByUID.get(uid);
        if (!study) {
          return true;
        }
        return Number(study.numberOfStudyRelatedInstances || 0) > VERY_HEAVY_STUDY_MAX_INSTANCES;
      });
      const hasDuplicatePatientsInExistingProgress =
        new Set(existingPatientIds).size < existingPatientIds.length;
      const needsReassignment =
        !!existingProgress &&
        (existingProgress.targetCount !== expectedTargetCount ||
          existingProgress.studyUIDs.length !== expectedTargetCount ||
          hasDuplicatePatientsInExistingProgress ||
          hasVeryHeavyStudiesInExistingProgress);

      if (existingProgress && !needsReassignment) {
        progress = existingProgress;
      } else {
        const assignedStudyUIDs = assignStudyUIDsForMode({
          modeId: studyOption.id,
          availableStudies,
          participantGroups,
          modePatientCounts,
        });
        const targetCount = assignedStudyUIDs.length;
        const existingCompleted = new Set(existingProgress?.completedStudyUIDs || []);
        const completedStudyUIDs = assignedStudyUIDs.filter(uid => existingCompleted.has(uid));

        progress = {
          participantCode,
          modeId: studyOption.id,
          route: studyOption.route,
          targetCount,
          studyUIDs: assignedStudyUIDs,
          completedStudyUIDs,
          isComplete: completedStudyUIDs.length >= targetCount,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      console.info(`[StudyAssignment:${studyOption.id}] Progress study list`, {
        participantCode,
        studyUIDs: progress.studyUIDs,
        patientIds: progress.studyUIDs.map(uid => patientIdByStudyUID.get(uid) || 'unknown'),
        instanceCounts: progress.studyUIDs.map(
          uid => availableStudyByUID.get(uid)?.numberOfStudyRelatedInstances ?? -1
        ),
        completedStudyUIDs: progress.completedStudyUIDs,
      });

      if (progress.isComplete) {
        refreshModeCompletion(participantCode);
        setEntryError(`${studyOption.title} is already complete for participant ${participantCode}.`);
        clearLaunchState();
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
        clearLaunchState();
        return;
      }

      console.info(`[StudyAssignment:${studyOption.id}] Launching next case`, {
        participantCode,
        nextStudyUID,
        nextPatientId: patientIdByStudyUID.get(nextStudyUID) || 'unknown',
        nextStudyInstanceCount:
          availableStudyByUID.get(nextStudyUID)?.numberOfStudyRelatedInstances ?? -1,
      });

      writeModeProgress({ ...progress, updatedAt: new Date().toISOString() });
      setPendingLaunchUrl(
        `${studyOption.route}?StudyInstanceUIDs=${encodeURIComponent(
          nextStudyUID
        )}&participantCode=${encodeURIComponent(participantCode)}`
      );
    } catch (error) {
      console.error('SearchHomePage: failed to enter study mode', error);
      setEntryError('Could not launch study mode right now. Please try again.');
      clearLaunchState();
    }
  };

  if (selectedModeId) {
    if (!modeLaunchNextClicked) {
      const isJudgeMode = selectedModeId === 'judge';
      const heading = isJudgeMode
        ? 'Report Evaluation Mode Instructions'
        : 'Report Comparison Mode Instructions';
      const title = isJudgeMode ? 'Read Before Starting' : 'Read Before Comparing Reports';
      const instructionParagraphs = isJudgeMode
        ? JUDGE_MODE_PRELAUNCH_INSTRUCTIONS
        : PARTICIPANT_MODE_PRELAUNCH_INSTRUCTIONS;
      const instructionTextClassName = isJudgeMode
        ? 'mt-5 space-y-5 text-base leading-8 text-white/95 md:text-lg'
        : 'mt-5 space-y-5 text-lg leading-9 text-white/95 md:text-xl';

      return (
        <div className="flex min-h-screen items-center justify-center bg-[#2563eb] px-6 py-10">
          <div className="w-full max-w-5xl rounded-2xl border border-white/20 bg-[#1d4ed8]/70 p-8 text-white shadow-2xl shadow-black/30">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-white/75">
              {heading}
            </p>
            <h1 className="mt-2 text-3xl font-black leading-tight">{title}</h1>
            <div className={instructionTextClassName}>
              {instructionParagraphs.map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            {isJudgeMode && (
              <div className="mt-6 rounded-2xl border border-white/15 bg-[#102a64]/70 p-5">
                <p className="text-lg font-bold text-white">Criteria for Judging the Reports</p>
                <div className="mt-3 space-y-3 text-base leading-8 text-white/95 md:text-lg">
                  {JUDGE_MODE_CRITERIA.map((criterion, index) => (
                    <p key={criterion}>
                      <span className="font-semibold">{index + 1}. </span>
                      {criterion}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
              {!pendingLaunchUrl && (
                <span className="text-xs font-semibold text-white/80">Preparing the first case...</span>
              )}
              <button
                type="button"
                onClick={() => {
                  setModeLaunchNextClicked(true);
                  if (!pendingLaunchUrl) {
                    setIsLaunchingStudy(true);
                  }
                }}
                className="rounded-full bg-white px-6 py-2.5 text-base font-bold text-[#1d4ed8] transition-colors hover:bg-[#dbeafe]"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#2563eb]">
        <div className="flex flex-col items-center gap-4">
          <svg
            width="56"
            height="56"
            viewBox="0 0 56 56"
            role="img"
            aria-label="Loading study"
          >
            <circle
              cx="28"
              cy="28"
              r="22"
              fill="none"
              stroke="#93c5fd"
              strokeWidth="6"
              opacity="0.4"
            />
            <path
              d="M28 6a22 22 0 0 1 22 22"
              fill="none"
              stroke="#ffffff"
              strokeWidth="6"
              strokeLinecap="round"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 28 28"
                to="360 28 28"
                dur="0.9s"
                repeatCount="indefinite"
              />
            </path>
          </svg>
          <p className="text-sm font-semibold text-white">
            {isLaunchingStudy ? 'Loading study...' : 'Preparing study...'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e3a8a_0%,#0b1025_45%,#050816_100%)] px-6 py-10 text-white">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-8 rounded-2xl border border-white/15 bg-[#091534]/80 p-6 shadow-xl shadow-black/30">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-[#93c5fd]">User Study Entry</p>
          <h1 className="mt-2 text-3xl font-black leading-tight text-white">Radiology Study Launcher</h1>
          <p className="mt-2 max-w-3xl text-sm text-white/80">
            Complete participant demographics, then finish Report Evaluation Mode first. Report
            Comparison Mode unlocks after Report Evaluation Mode is complete.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
          <section className="rounded-2xl border border-white/15 bg-[#0a1738]/85 p-6 shadow-lg shadow-black/30">
            <h2 className="text-lg font-bold text-white">Participant Demographics</h2>
            <p className="mt-1 text-sm text-white/75">All fields are required before mode selection.</p>

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-white/90">Assigned Participant ID</span>
                <input
                  type="text"
                  value={demographics.participantCode}
                  readOnly
                  className="mt-2 w-full cursor-default rounded-xl border border-white/20 bg-[#07112b]/70 px-3 py-2 text-sm font-semibold text-white outline-none"
                />
                <span className="mt-1 block text-xs text-white/60">
                  This ID is assigned automatically for this study session.
                </span>
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
            <h2 className="text-lg font-bold text-white">Select User Study Mode</h2>
            <p className="mt-1 text-sm text-white/75">
              Click a user study to participate in.
            </p>
            {canUseQuickTestBypass && (
              <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-[#60a5fa]/40 bg-[#102a64]/60 px-3 py-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-[#93c5fd]">
                    Quick Test
                  </p>
                  <p className="text-xs text-white/75">
                    Unlock Report Comparison Mode without completing Report Evaluation Mode first.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setComparisonQuickTestBypass(prev => !prev)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                    comparisonQuickTestBypass
                      ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                      : 'bg-white/15 text-white hover:bg-white/25'
                  }`}
                >
                  {comparisonQuickTestBypass ? 'Bypass On' : 'Bypass Off'}
                </button>
              </div>
            )}

            <div className="mt-5 grid gap-4">
              {STUDY_OPTIONS.map(option => {
                const isLoading = selectedModeId === option.id;
                const isComplete = modeCompletion[option.id];
                const isLockedByJudge =
                  option.id === 'participant' &&
                  !modeCompletion.judge &&
                  !comparisonQuickTestBypass;
                const isDisabled =
                  !demographicsSaved || !!selectedModeId || isComplete || isLockedByJudge;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleStudyEntry(option)}
                    disabled={isDisabled}
                    className={`w-full rounded-2xl border p-5 text-left shadow-md transition-all ${option.badgeClassName} ${
                      isDisabled && !isLoading
                        ? 'cursor-not-allowed opacity-50'
                        : 'hover:-translate-y-0.5 hover:shadow-xl'
                    }`}
                  >
                    {/* <p className="text-xs font-black uppercase tracking-[0.16em] text-white/70">Mode Option</p> */}
                    <p className="mt-2 text-xl font-black text-white">{option.title}</p>
                    <p className="mt-2 text-sm text-white/80">{option.subtitle}</p>
                    <p className="mt-4 text-xs font-semibold text-white/70">
                      {isLockedByJudge
                        ? 'Locked until Report Evaluation Mode is complete'
                        : option.id === 'participant' &&
                            comparisonQuickTestBypass &&
                            !modeCompletion.judge
                          ? 'Quick Test Bypass enabled: launch unlocked'
                        : isComplete
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
