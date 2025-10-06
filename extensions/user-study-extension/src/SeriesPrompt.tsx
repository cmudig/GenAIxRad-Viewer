import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getMetadataFromSeries } from '../../../platform/app/src/components/dicom_helpers';

type SeriesPromptProps = {
  servicesManager: any;
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

  const syncFromViewportState = useCallback(() => {
    if (!viewportGridService) {
      return;
    }

    const state = viewportGridService.getState?.() || viewportGridService.getViewportGridState?.();
    const viewports = getViewportsArray(state);

    const resolvedActiveId = state?.activeViewportId ?? viewports[0]?.viewportId ?? null;
    setActiveViewportId(prev => (prev === resolvedActiveId ? prev : resolvedActiveId));

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

  // ---------- Track viewport grid changes ----------
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

  // ---------- Also listen for display sets being added (async study load) ----------
  useEffect(() => {
    if (!displaySetService || !viewportGridService) {
      return;
    }

    const onAdded = () => {
      // Re-resolve for current viewport when new display sets appear
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
      seriesPrompt != null ? `${seriesPrompt}` : `Prompt used to generate CT scan not found`;

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
