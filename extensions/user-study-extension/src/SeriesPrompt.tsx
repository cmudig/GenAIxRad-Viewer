import React, { useEffect, useMemo, useState } from 'react';

type SeriesPromptProps = {
  servicesManager: any;
};

const SeriesPrompt: React.FC<SeriesPromptProps> = ({ servicesManager }) => {
  const { ViewportGridService, DisplaySetService } = servicesManager.services;

  const [activeViewportId, setActiveViewportId] = useState<string | null>(null);
  const [displaySetUID, setDisplaySetUID] = useState<string | null>(null);

  // Track active viewport id
  useEffect(() => {
    // initial
    try {
      const state =
        ViewportGridService.getState?.() || ViewportGridService.getViewportGridState?.();
      setActiveViewportId(state?.activeViewportId ?? null);
    } catch {
      // no-op
    }

    const sub1 = ViewportGridService?.subscribe?.(
      ViewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
      ({ viewportId }: { viewportId: string }) => setActiveViewportId(viewportId)
    );

    const sub2 = ViewportGridService?.subscribe?.(
      ViewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
      () => {
        const s = ViewportGridService.getState?.() || ViewportGridService.getViewportGridState?.();
        setActiveViewportId(s?.activeViewportId ?? null);
      }
    );

    return () => {
      sub1?.unsubscribe?.();
      sub2?.unsubscribe?.();
    };
  }, [ViewportGridService]);

  // Resolve displaySetInstanceUID for the active viewport
  useEffect(() => {
    if (!activeViewportId) {
      return;
    }
    const state = ViewportGridService.getState?.() || ViewportGridService.getViewportGridState?.();
    const vp = state?.viewports?.find?.((v: any) => v.viewportId === activeViewportId) ?? null;

    const uids: string[] =
      vp?.displaySetInstanceUIDs || vp?.displaySetOptions?.displaySetInstanceUIDs || [];

    setDisplaySetUID(uids?.[0] ?? null);
  }, [activeViewportId, ViewportGridService]);

  // Pull the display set + metadata
  const ds = useMemo(() => {
    if (!displaySetUID) {
      return null;
    }
    try {
      return DisplaySetService.getDisplaySetByUID(displaySetUID);
    } catch {
      return null;
    }
  }, [displaySetUID, DisplaySetService]);

  // Build a readable prompt string for LLMs
  const prompt = useMemo(() => {
    if (!ds) {
      return 'No series selected.';
    }
    const {
      Modality,
      SeriesDescription,
      SeriesDate,
      SeriesTime,
      SeriesNumber,
      SeriesInstanceUID,
      SeriesSize,
      FrameOfReferenceUID,
      StudyInstanceUID,
      isClip, // OHIF adds some helpers on certain display sets
      metadata,
      // Common fields from OHIF display sets:
      SeriesDateTime,
      numImageFrames,
      sopClassUids,
      StudyDate,
      StudyTime,
      StudyDescription,
      SeriesNumberUI,
    } = ds as any;

    // Pull some useful bits from instance metadata if present
    const m = metadata || {};
    const bodyPart = m.BodyPartExamined || m.AnatomicRegionSequence?.[0]?.CodeMeaning;
    const contrast = m?.ContrastBolusAgent || m?.CTAcquisitionDetails?.ContrastBolusAgent;
    const sliceThickness = m?.SliceThickness;
    const kvp = m?.KVP || m?.KVPValue;
    const kernel = m?.ConvolutionKernel;
    const patientSex = m?.PatientSex;
    const patientAge = m?.PatientAge;
    const institution = m?.InstitutionName;

    const numImages = numImageFrames || SeriesSize || ds?.images?.length || ds?.instances?.length;

    // Compose
    const lines = [
      `Series Prompt`,
      `Modality: ${Modality ?? 'CT'}`,
      `Series: ${SeriesDescription || '(no description)'}${SeriesNumber ? ` (#${SeriesNumber})` : ''}`,
      `Images: ${numImages ?? 'unknown'}`,
      bodyPart ? `Body part: ${bodyPart}` : null,
      contrast ? `Contrast: ${contrast}` : null,
      sliceThickness ? `Slice thickness: ${sliceThickness} mm` : null,
      kernel ? `Kernel: ${kernel}` : null,
      kvp ? `kVp: ${kvp}` : null,
      StudyDate || SeriesDate ? `Date: ${SeriesDate || StudyDate}` : null,
      StudyDescription ? `Study: ${StudyDescription}` : null,
      patientSex || patientAge
        ? `Patient: ${[patientSex, patientAge].filter(Boolean).join(', ')}`
        : null,
      institution ? `Institution: ${institution}` : null,
      `DisplaySet UID: ${SeriesInstanceUID || displaySetUID}`,
    ].filter(Boolean);

    // A compact, LLM-ready summary at the end:
    const oneLiner = [
      Modality || 'CT',
      bodyPart,
      contrast ? 'with contrast' : 'non-contrast',
      sliceThickness ? `${sliceThickness}mm` : '',
      SeriesDescription,
    ]
      .filter(Boolean)
      .join(', ');

    return `${lines.join('\n')}\n\nSummary: ${oneLiner}`;
  }, [ds, displaySetUID]);

  return (
    <div className="border-primary-main h-full w-full overflow-auto rounded-md border p-3">
      <div className="text-primary-light mb-2 text-xs uppercase tracking-wider">Series Prompt</div>
      <pre className="text-aqua-pale whitespace-pre-wrap text-[13px] leading-snug">{prompt}</pre>
    </div>
  );
};

export default SeriesPrompt;
