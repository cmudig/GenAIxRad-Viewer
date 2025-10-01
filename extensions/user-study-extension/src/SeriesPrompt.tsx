import React, { useEffect, useMemo, useState } from 'react';
import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';

type SeriesPromptProps = {
  servicesManager: any;
};

const SeriesPrompt: React.FC<SeriesPromptProps> = ({ servicesManager }) => {
  // Support both naming styles used across your app
  const viewportGridService =
    servicesManager?.services?.viewportGridService ||
    servicesManager?.services?.ViewportGridService;
  const displaySetService =
    servicesManager?.services?.displaySetService || servicesManager?.services?.DisplaySetService;

  const [activeViewportId, setActiveViewportId] = useState<string | null>(null);
  const [displaySetUID, setDisplaySetUID] = useState<string | null>(null);
  const [seriesInstanceUID, setSeriesInstanceUID] = useState<string | null>(null);

  const [seriesPrompt, setSeriesPrompt] = useState<string | null>(null);
  const [seriesPromptChanged, setSeriesPromptChanged] = useState<boolean>(false);
  const [loadingMeta, setLoadingMeta] = useState<boolean>(false);

  // tick to force re-fetch on external events (e.g., Generate button)
  const [refreshTick, setRefreshTick] = useState(0);

  // ---------- Bootstrap immediately on entry ----------
  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    // 1) Try to get the active viewport right now
    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    let initialActive = state?.activeViewportId ?? null;

    // If none is marked active yet, pick the first viewport we can find
    if (!initialActive) {
      const vps = state?.viewports;
      if (Array.isArray(vps) && vps.length) {
        initialActive = vps[0]?.viewportId ?? null;
      } else if (vps?.keys) {
        const firstKey = vps.keys().next();
        if (!firstKey.done) {
          initialActive = firstKey.value ?? null;
        }
      }
    }
    if (initialActive) {
      setActiveViewportId(prev => prev ?? initialActive);
    }

    // 2) If we still didn't get a display set yet, try to resolve once on mount
    if (initialActive) {
      const s = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const vp = Array.isArray(s?.viewports)
        ? s.viewports.find((v: any) => v?.viewportId === initialActive)
        : s?.viewports?.get?.(initialActive);
      const uids: string[] =
        vp?.displaySetInstanceUIDs || vp?.displaySetOptions?.displaySetInstanceUIDs || [];
      if (uids?.[0]) {
        setDisplaySetUID(prev => prev ?? uids[0]);
      }
    }
  }, [viewportGridService]);

  // ---------- Listen for Generate button refresh pings ----------
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

  // ---------- Track active viewport changes ----------
  useEffect(() => {
    if (!viewportGridService) {
      return;
    }

    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    setActiveViewportId(prev => prev ?? state?.activeViewportId ?? null);

    const sub1 = viewportGridService?.subscribe?.(
      viewportGridService.EVENTS?.ACTIVE_VIEWPORT_ID_CHANGED || 'ACTIVE_VIEWPORT_ID_CHANGED',
      ({ viewportId }: { viewportId: string }) => setActiveViewportId(viewportId)
    );

    const sub2 = viewportGridService?.subscribe?.(
      viewportGridService.EVENTS?.GRID_STATE_CHANGED || 'GRID_STATE_CHANGED',
      () => {
        const s = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
        setActiveViewportId(s?.activeViewportId ?? null);
      }
    );

    return () => {
      sub1?.unsubscribe?.();
      sub2?.unsubscribe?.();
    };
  }, [viewportGridService]);

  // ---------- Resolve displaySetInstanceUID for the active viewport ----------
  useEffect(() => {
    if (!activeViewportId || !viewportGridService) {
      return;
    }

    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    const vp = Array.isArray(state?.viewports)
      ? state.viewports.find((v: any) => v?.viewportId === activeViewportId)
      : state?.viewports?.get?.(activeViewportId);

    const uids: string[] =
      vp?.displaySetInstanceUIDs || vp?.displaySetOptions?.displaySetInstanceUIDs || [];

    setDisplaySetUID(uids?.[0] ?? null);
  }, [activeViewportId, viewportGridService]);

  // ---------- Also listen for display sets being added (async study load) ----------
  useEffect(() => {
    if (!displaySetService || !viewportGridService) {
      return;
    }

    const onAdded = () => {
      // Re-resolve for current viewport when new display sets appear
      const s = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
      const vp = Array.isArray(s?.viewports)
        ? s.viewports.find((v: any) => v?.viewportId === (s?.activeViewportId ?? activeViewportId))
        : s?.viewports?.get?.(s?.activeViewportId ?? activeViewportId);
      const uids: string[] =
        vp?.displaySetInstanceUIDs || vp?.displaySetOptions?.displaySetInstanceUIDs || [];
      if (uids?.[0]) {
        setDisplaySetUID(uids[0]);
      }
    };

    const sub =
      displaySetService?.subscribe?.(
        displaySetService.EVENTS?.DISPLAY_SETS_ADDED || 'DISPLAY_SETS_ADDED',
        onAdded
      ) || null;

    return () => sub?.unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySetService, viewportGridService, activeViewportId]);

  // ---------- Get display set & series UID ----------
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
    setSeriesInstanceUID((ds as any)?.SeriesInstanceUID ?? null);
  }, [ds]);

  // ---------- Fetch SeriesPrompt and SeriesPromptChanged from metadata ----------
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
          const v = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPrompt');
          prompt = typeof v === 'string' && v.trim() ? v : null;
        } catch {
          /* key may be absent */
        }

        let changed = false;
        try {
          const f = await getMetadataFromSeries(seriesInstanceUID, 'SeriesPromptChanged');
          changed = String(f).toLowerCase() === 'true';
        } catch {
          /* key may be absent */
        }

        if (!cancelled) {
          setSeriesPrompt(prompt);
          setSeriesPromptChanged(changed);
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
    // re-fetch when series changes OR when external refresh is requested
  }, [seriesInstanceUID, refreshTick]);

  // ---------- Compose display text ----------
  const promptBlock = useMemo(() => {
    if (!ds) {
      return 'No series selected.';
    }

    const { Modality, SeriesDescription, SeriesNumber, numImageFrames, SeriesSize, images } =
      ds as any;

    const numImages = numImageFrames || SeriesSize || images?.length;

    // const header = [
    //   `Modality: ${Modality ?? 'Unknown'}`,
    //   `Series: ${SeriesDescription || '(no description)'}${SeriesNumber ? ` (#${SeriesNumber})` : ''}`,
    //   `Images: ${numImages ?? 'unknown'}`,
    //   `SeriesInstanceUID: ${seriesInstanceUID || '(unknown)'}`,
    // ].join('\n');

    const meta =
      seriesPrompt != null
        ? `\n\nPrompt used to generate CT scan:\n${seriesPrompt}`
        : `\n\nPrompt used to generate CT scan: (not found)`;

    // const changedLine = seriesPromptChanged ? `\n\nNote: SeriesPromptChanged = true` : '';

    return `${meta}`;
  }, [ds, seriesInstanceUID, seriesPrompt, seriesPromptChanged]);

  return (
    <div className="border-primary-main h-full w-full overflow-auto rounded-md border p-3">
      <div className="text-primary-light mb-2 text-xs uppercase tracking-wider">Series Prompt</div>
      <pre className="text-aqua-pale whitespace-pre-wrap text-[13px] leading-snug">
        {loadingMeta ? 'Loading series prompt…' : promptBlock}
      </pre>
    </div>
  );
};

export default SeriesPrompt;
