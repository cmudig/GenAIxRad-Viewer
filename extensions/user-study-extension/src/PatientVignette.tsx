import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';

type PatientVignetteProps = {
  servicesManager: any;
};

const PMAP_SOP_CLASS_UID = '1.2.840.10008.5.1.4.1.1.30';

const textOrNull = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

type RandomVignette = {
  patientName: string;
  patientId: string;
  age: string;
  sex: string;
  bodyPart: string;
  studyDate: string;
  headline: string;
  details: string[];
  imagingHighlights: string[];
};

const firstNames = [
  'Jillian',
  'Marcus',
  'Priya',
  'Elena',
  'Noah',
  'Grace',
  'Carlos',
  'Amelia',
  'Ravi',
  'Sofia',
];

const lastNames = [
  'Chen',
  'Patel',
  'Martinez',
  'Walker',
  'Nguyen',
  'Lopez',
  'Hughes',
  'Jensen',
  'Santiago',
  'Khan',
];

const symptomTriggers = [
  'progressively worsening shortness of breath',
  'pleuritic chest pain that worsens when lying flat',
  'persistent cough with scant sputum production',
  'orthopnea requiring multiple pillows at night',
  'acute dyspnea following a recent viral illness',
  'increasing abdominal distension with dyspnea on exertion',
];

const riskFactors = [
  'recent community-acquired pneumonia treated with antibiotics',
  'a history of congestive heart failure with prior hospitalizations',
  'known metastatic breast carcinoma on chemotherapy',
  'long-standing rheumatoid arthritis on immunosuppressants',
  'cirrhosis with recurrent admissions for ascites',
  'recent coronary artery bypass grafting two weeks ago',
];

const imagingReasons = [
  'persistent respiratory distress despite diuretics',
  'abnormal chest radiograph suggesting layering fluid',
  'concern for parapneumonic effusion not responding to therapy',
  'pre-thoracentesis planning requested by pulmonology',
  'evaluation of suspected malignant effusion',
];

const examFindings = [
  'dullness to percussion over the right posterior lung field',
  'decreased breath sounds at the left base',
  'use of accessory muscles with mild tachypnea',
  'jugular venous distention and bilateral lower extremity edema',
  'egophony superior to the area of dullness',
];

const labHighlights = [
  'elevated CRP and leukocytosis of 14,000/µL',
  'BNP of 950 pg/mL with mild hyponatremia',
  'LDH of 900 U/L with low glucose on pleural fluid sample',
  'borderline anemia with hematocrit of 31%',
  'serum albumin of 2.4 g/dL indicating hypoalbuminemia',
];

const effusionSides = ['right', 'left', 'bilateral'];
const effusionSeverities = ['small', 'moderate', 'large'];
const associatedFindings = [
  'compressive atelectasis of the lower lobe',
  'mediastinal shift toward the contralateral hemithorax',
  'mild pericardial effusion without tamponade',
  'lobar consolidation adjacent to the effusion',
  'enhancing pleural thickening concerning for malignancy',
];

const randomFrom = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

const randomPatientId = () => `PE-${Math.floor(100000 + Math.random() * 900000)}`;

const randomAge = () => `${Math.floor(32 + Math.random() * 45)} years`;

const randomStudyDate = () => {
  const date = new Date();
  date.setDate(date.getDate() - Math.floor(Math.random() * 90));
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const generatePleuralEffusionVignette = (): RandomVignette => {
  const firstName = randomFrom(firstNames);
  const lastName = randomFrom(lastNames);
  const sex = randomFrom(['Female', 'Male']);
  const sexDescriptor = sex === 'Female' ? 'woman' : 'man';
  const pronoun = sex === 'Female' ? 'her' : 'his';
  const side = randomFrom(effusionSides);
  const severity = randomFrom(effusionSeverities);
  const effusionPhrase =
    side === 'bilateral' ? `${severity} bilateral pleural effusions` : `${severity} ${side}-sided pleural effusion`;

  const headline = `A ${randomAge()} ${sexDescriptor} with ${randomFrom(
    symptomTriggers
  )} in the setting of ${randomFrom(riskFactors)}.`;

  const details = [
    `Reports ${randomFrom(symptomTriggers)} and notes ${pronoun} symptoms worsen in the evening.`,
    `Exam reveals ${randomFrom(examFindings)} with oxygen saturation drifting to 90% on room air.`,
    `Workup initiated because of ${randomFrom(imagingReasons)}.`,
    `Recent labs show ${randomFrom(labHighlights)}.`,
    `Clinicians are evaluating for ${effusionPhrase} requiring drainage.`,
  ];

  const imaging = [
    'CT Chest · Contrast-enhanced axial lung window series',
    `Imaging demonstrates a ${effusionPhrase} with classic meniscus configuration.`,
    `There is ${randomFrom(associatedFindings)}.`,
  ];

  return {
    patientName: `${firstName} ${lastName}`,
    patientId: randomPatientId(),
    age: randomAge(),
    sex,
    bodyPart: 'Thorax',
    studyDate: randomStudyDate(),
    headline,
    details,
    imagingHighlights: imaging,
  };
};

const getReferencedSeriesInstanceUID = (displaySet: any): string | null => {
  if (!displaySet) {
    return null;
  }

  return (
    displaySet.referencedSeriesInstanceUID ??
    displaySet.ReferencedSeriesInstanceUID ??
    displaySet.getAttribute?.('ReferencedSeriesInstanceUID') ??
    displaySet.metadata?.ReferencedSeriesInstanceUID ??
    null
  );
};

const getSeriesPromptFromDisplaySet = (displaySet: any) => {
  if (!displaySet) {
    return { prompt: null as string | null, changed: false };
  }

  const prompt =
    displaySet.SeriesPrompt ??
    displaySet.seriesPrompt ??
    displaySet.metadata?.SeriesPrompt ??
    displaySet.getAttribute?.('SeriesPrompt') ??
    null;

  const changedRaw =
    displaySet.SeriesPromptChanged ??
    displaySet.seriesPromptChanged ??
    displaySet.metadata?.SeriesPromptChanged ??
    displaySet.getAttribute?.('SeriesPromptChanged') ??
    null;

  const changed = String(changedRaw).toLowerCase() === 'true';

  return {
    prompt: typeof prompt === 'string' && prompt.trim() ? prompt : null,
    changed,
  };
};

const getViewportsArray = (state: any): any[] => {
  if (!state?.viewports) {
    return [];
  }

  const { viewports } = state;

  if (Array.isArray(viewports)) {
    return viewports;
  }

  if (typeof viewports.values === 'function') {
    return Array.from(viewports.values());
  }

  if (typeof viewports === 'object') {
    return Object.values(viewports);
  }

  return [];
};

const formatDicomAge = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const match = value.match(/(\d+)([YMWD])/i);
  if (!match) {
    return value;
  }

  const amount = parseInt(match[1], 10);
  const unit = match[2].toUpperCase();

  const unitMap: Record<string, string> = {
    Y: 'years',
    M: 'months',
    W: 'weeks',
    D: 'days',
  };

  const label = unitMap[unit] ?? unit;
  if (Number.isNaN(amount)) {
    return value;
  }

  return `${amount} ${label}`;
};

const formatStudyDate = (value: string | null): string | null => {
  if (!value) {
    return null;
  }

  const sanitized = value.replace(/[^0-9]/g, '');
  if (sanitized.length !== 8) {
    return value;
  }

  const year = sanitized.slice(0, 4);
  const month = sanitized.slice(4, 6);
  const day = sanitized.slice(6, 8);

  const parsed = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const buildPromptNarrative = (prompt: string | null) => {
  if (!prompt) {
    return { headline: null, details: [] as string[] };
  }

  const cleaned = prompt.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return { headline: null, details: [] };
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+|,\s+/)
    .map(part => part.trim())
    .filter(Boolean);

  if (!sentences.length) {
    return { headline: cleaned, details: [] };
  }

  return {
    headline: sentences[0],
    details: sentences.slice(1, 4),
  };
};

const PatientVignette: React.FC<PatientVignetteProps> = ({ servicesManager }) => {
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;

  const [displaySetUID, setDisplaySetUID] = useState<string | null>(null);
  const [seriesInstanceUID, setSeriesInstanceUID] = useState<string | null>(null);

  const [seriesPrompt, setSeriesPrompt] = useState<string | null>(null);
  const [seriesPromptChanged, setSeriesPromptChanged] = useState<boolean>(false);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(false);

  const [refreshTick, setRefreshTick] = useState(0);
  const randomVignetteCacheRef = useRef<Map<string, RandomVignette>>(new Map());

  const syncFromViewportState = useCallback(() => {
    if (!viewportGridService) {
      return;
    }

    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    const viewports = getViewportsArray(state);

    const resolvedActiveId = state?.activeViewportId ?? viewports[0]?.viewportId ?? null;

    const activeViewport =
      viewports.find(v => v?.viewportId === resolvedActiveId) ?? viewports[0] ?? null;

    const candidateUID =
      activeViewport?.displaySetInstanceUIDs?.[0] ||
      activeViewport?.displaySetOptions?.displaySetInstanceUIDs?.[0] ||
      null;

    if (candidateUID) {
      setDisplaySetUID(prev => (prev === candidateUID ? prev : candidateUID));
      return;
    }

    const activeDisplaySets = displaySetService?.getActiveDisplaySets?.() ?? [];
    if (activeDisplaySets.length) {
      const fallbackUID = activeDisplaySets[0]?.displaySetInstanceUID ?? null;
      if (fallbackUID) {
        setDisplaySetUID(prev => (prev === fallbackUID ? prev : fallbackUID));
        return;
      }
    }

    setDisplaySetUID(null);
  }, [displaySetService, viewportGridService]);

  useEffect(() => {
    const onRefresh = (e: Event) => {
      const ce = e as CustomEvent<{ seriesInstanceUID?: string }>;
      if (!ce.detail?.seriesInstanceUID || ce.detail.seriesInstanceUID === seriesInstanceUID) {
        setRefreshTick(t => t + 1);
      }
    };
    window.addEventListener('series-metadata-refresh', onRefresh);
    return () => window.removeEventListener('series-metadata-refresh', onRefresh);
  }, [seriesInstanceUID]);

  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    syncFromViewportState();

    const subActive = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
      () => syncFromViewportState()
    );

    const subGrid = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
      () => syncFromViewportState()
    );

    const subReady = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.VIEWPORTS_READY || 'VIEWPORTS_READY',
      () => syncFromViewportState()
    );

    const subLayout = viewportGridService.subscribe?.(
      viewportGridService.EVENTS?.LAYOUT_CHANGED || 'LAYOUT_CHANGED',
      () => syncFromViewportState()
    );

    return () => {
      subActive?.unsubscribe?.();
      subGrid?.unsubscribe?.();
      subReady?.unsubscribe?.();
      subLayout?.unsubscribe?.();
    };
  }, [syncFromViewportState, viewportGridService]);

  useEffect(() => {
    if (!displaySetService || !viewportGridService) {
      return;
    }

    const onAdded = () => {
      syncFromViewportState();
    };

    const sub =
      displaySetService?.subscribe?.(
        displaySetService.EVENTS?.DISPLAY_SETS_ADDED || 'DISPLAY_SETS_ADDED',
        onAdded
      ) || null;

    return () => sub?.unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySetService, viewportGridService, syncFromViewportState]);

  const ds = useMemo(() => {
    if (!displaySetUID || !displaySetService) {
      return null;
    }
    try {
      return displaySetService.getDisplaySetByUID(displaySetUID);
    } catch {
      return null;
    }
  }, [displaySetUID, displaySetService]);

  useEffect(() => {
    if (!ds) {
      setSeriesInstanceUID(null);
      return;
    }

    const sopClassUID = String((ds as any)?.SOPClassUID ?? '');

    if (sopClassUID === PMAP_SOP_CLASS_UID) {
      const referenced = getReferencedSeriesInstanceUID(ds);
      setSeriesInstanceUID(referenced ?? null);
      return;
    }

    const uid =
      (ds as any)?.SeriesInstanceUID ??
      ds?.metadata?.SeriesInstanceUID ??
      ds?.getAttribute?.('SeriesInstanceUID') ??
      null;

    setSeriesInstanceUID(uid ?? null);
  }, [ds]);

  useEffect(() => {
    if (!ds) {
      return;
    }

    const { prompt, changed } = getSeriesPromptFromDisplaySet(ds);

    if (prompt && !seriesPrompt) {
      setSeriesPrompt(prompt);
    }

    if (changed && !seriesPromptChanged) {
      setSeriesPromptChanged(true);
    }
  }, [ds, seriesPrompt, seriesPromptChanged]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!seriesInstanceUID) {
        setSeriesPrompt(null);
        setSeriesPromptChanged(false);
        return;
      }
      setLoadingMeta(true);
      try {
        let prompt: string | null = null;
        try {
          const value = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPrompt');
          prompt = typeof value === 'string' && value.trim() ? value : null;
        } catch {
          /* metadata may be missing */
        }

        let changed = false;
        try {
          const flag = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPromptChanged');
          changed = String(flag).toLowerCase() === 'true';
        } catch {
          /* metadata may be missing */
        }

        if (!cancelled) {
          setSeriesPrompt(prev => (prompt ?? prev ?? null));
          setSeriesPromptChanged(prev => changed || prev);
        }
      } finally {
        if (!cancelled) {
          setLoadingMeta(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [seriesInstanceUID, refreshTick]);

  const demographics = useMemo(() => {
    if (!ds) {
      return {
        patientName: null,
        patientId: null,
        age: null,
        sex: null,
        bodyPart: null,
      };
    }

    const patientName = textOrNull(
      (ds as any)?.patientName,
      (ds as any)?.PatientName,
      ds?.metadata?.PatientName
    );
    const patientId = textOrNull(
      (ds as any)?.patientId,
      (ds as any)?.PatientID,
      ds?.metadata?.PatientID
    );
    const age = formatDicomAge(
      textOrNull((ds as any)?.patientAge, (ds as any)?.PatientAge, ds?.metadata?.PatientAge)
    );
    const sex = textOrNull(
      (ds as any)?.patientSex,
      (ds as any)?.PatientSex,
      ds?.metadata?.PatientSex
    );
    const bodyPart = textOrNull(
      (ds as any)?.BodyPartExamined,
      ds?.metadata?.BodyPartExamined,
      (ds as any)?.SeriesBodyPart
    );

    return { patientName, patientId, age, sex, bodyPart };
  }, [ds]);

  const imagingMeta = useMemo(() => {
    if (!ds) {
      return {
        modality: null,
        studyDescription: null,
        seriesDescription: null,
        seriesNumber: null,
        studyDate: null,
      };
    }

    const modality = textOrNull(ds.Modality, ds?.metadata?.Modality);
    const studyDescription = textOrNull(
      (ds as any)?.StudyDescription,
      ds?.metadata?.StudyDescription
    );
    const seriesDescription = textOrNull(ds.SeriesDescription, ds?.metadata?.SeriesDescription);
    const seriesNumber = textOrNull(
      String((ds as any)?.SeriesNumber ?? ''),
      ds?.metadata?.SeriesNumber
    );
    const studyDate = formatStudyDate(
      textOrNull(
        (ds as any)?.StudyDate,
        (ds as any)?.studyDate,
        ds?.metadata?.StudyDate,
        (ds as any)?.SeriesDate
      )
    );

    return { modality, studyDescription, seriesDescription, seriesNumber, studyDate };
  }, [ds]);

  const fallbackVignette = useMemo(() => {
    const cacheKey = seriesInstanceUID ?? displaySetUID ?? 'global';
    if (!randomVignetteCacheRef.current.has(cacheKey)) {
      randomVignetteCacheRef.current.set(cacheKey, generatePleuralEffusionVignette());
    }
    return randomVignetteCacheRef.current.get(cacheKey)!;
  }, [displaySetUID, seriesInstanceUID]);

  const promptNarrative = useMemo(() => buildPromptNarrative(seriesPrompt), [seriesPrompt]);
  const isLoadingNarrative = loadingMeta && !seriesPrompt;

  const effectiveDemographics = {
    patientName: demographics.patientName ?? fallbackVignette.patientName,
    patientId: demographics.patientId ?? fallbackVignette.patientId,
    age: demographics.age ?? fallbackVignette.age,
    sex: demographics.sex ?? fallbackVignette.sex,
    bodyPart: demographics.bodyPart ?? fallbackVignette.bodyPart,
  };

  const imagingMetaHighlights = [
    imagingMeta.modality && imagingMeta.seriesDescription
      ? `${imagingMeta.modality} · ${imagingMeta.seriesDescription}`
      : imagingMeta.modality ?? imagingMeta.seriesDescription,
    imagingMeta.studyDescription,
    imagingMeta.seriesNumber ? `Series #${imagingMeta.seriesNumber}` : null,
  ].filter(Boolean);

  const displayNarrative = promptNarrative.headline
    ? promptNarrative
    : { headline: fallbackVignette.headline, details: fallbackVignette.details };

  const displayImagingHighlights = imagingMetaHighlights.length
    ? imagingMetaHighlights
    : fallbackVignette.imagingHighlights;

  const studyDateToShow = imagingMeta.studyDate ?? fallbackVignette.studyDate;

  const demographicLine = [effectiveDemographics.age, effectiveDemographics.sex, effectiveDemographics.bodyPart]
    .filter(Boolean)
    .join(' • ');

  return (
    <div className="h-full w-full overflow-auto">
      <div className="border-white/10 bg-black/40 text-white shadow-inner shadow-black/40 rounded-3xl border p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-white/60 text-xs uppercase tracking-[0.3em]">Patient Vignette</p>
            {seriesPromptChanged && (
              <span className="text-primary-light mt-1 inline-flex items-center rounded-full bg-primary-main/10 px-3 py-0.5 text-xs font-semibold">
                Clinician-edited details
              </span>
            )}
          </div>
          {studyDateToShow && (
            <p className="text-white/60 text-xs">Study date · {studyDateToShow}</p>
          )}
        </div>

        <div className="mt-4 space-y-4">
          <section className="rounded-2xl bg-white/5 p-4">
            <p className="text-white/50 text-xs uppercase tracking-wide">Demographics</p>
            <p className="mt-2 text-lg font-semibold">
              {effectiveDemographics.patientName ?? 'Generated patient'}
            </p>
            <p className="text-white/70 text-sm">
              {demographicLine || 'Patient age, sex, or body part not provided.'}
            </p>
            {effectiveDemographics.patientId && (
              <p className="text-white/40 mt-2 text-xs">Patient ID: {effectiveDemographics.patientId}</p>
            )}
          </section>

          <section className="rounded-2xl bg-[#0b1433] p-4 shadow-lg shadow-black/40">
            <p className="text-white/60 text-xs uppercase tracking-wide">Clinical Context</p>
            {isLoadingNarrative && (
              <p className="mt-2 text-sm text-white/70">Loading vignette narrative…</p>
            )}
            {!isLoadingNarrative && displayNarrative.headline && (
              <>
                <p className="mt-2 text-base leading-relaxed">{displayNarrative.headline}</p>
                {displayNarrative.details.length > 0 && (
                  <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-white/80">
                    {displayNarrative.details.map((detail, idx) => (
                      <li key={idx}>{detail}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!isLoadingNarrative && !displayNarrative.headline && (
              <p className="mt-2 text-sm text-white/70">
                No clinical narrative provided for this series.
              </p>
            )}
          </section>

          <section className="rounded-2xl bg-white/5 p-4">
            <p className="text-white/60 text-xs uppercase tracking-wide">Imaging Details</p>
            {displayImagingHighlights.length ? (
              <ul className="mt-2 space-y-1 text-sm text-white/80">
                {displayImagingHighlights.map((line, idx) => (
                  <li key={idx}>{line}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-white/70">Series description not available.</p>
            )}
            {seriesInstanceUID && (
              <p className="text-white/40 mt-3 truncate text-xs">Series UID: {seriesInstanceUID}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default PatientVignette;
