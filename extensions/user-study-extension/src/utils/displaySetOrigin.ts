export type CaseOrigin = 'patient' | 'ai';

type PendingOrigin = {
  origin: CaseOrigin;
  attempts: number;
  displaySetService: any;
};

const pendingOrigins = new Map<string, PendingOrigin>();
const MAX_ORIGIN_ATTEMPTS = 6;
const ORIGIN_RETRY_DELAY_MS = 250;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const normalizeIds = (value: string | string[] | null | undefined): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.filter(Boolean) : [value];
};

const trySetOrigin = (displaySetService: any, uid: string, origin: CaseOrigin): boolean => {
  if (!displaySetService?.getDisplaySetByUID) {
    return false;
  }

  const displaySet = displaySetService.getDisplaySetByUID(uid);
  if (!displaySet) {
    return false;
  }

  if (origin === 'patient') {
    (displaySet as any).__caseOrigin = 'patient';
    return true;
  }

  if ((displaySet as any).__caseOrigin === 'patient') {
    return true;
  }

  (displaySet as any).__caseOrigin = 'ai';
  return true;
};

const scheduleOriginRetry = () => {
  if (retryTimer) {
    return;
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;

    for (const [uid, entry] of pendingOrigins.entries()) {
      const resolved = trySetOrigin(entry.displaySetService, uid, entry.origin);
      if (resolved) {
        pendingOrigins.delete(uid);
        continue;
      }

      entry.attempts += 1;
      if (entry.attempts >= MAX_ORIGIN_ATTEMPTS) {
        pendingOrigins.delete(uid);
      }
    }

    if (pendingOrigins.size) {
      scheduleOriginRetry();
    }
  }, ORIGIN_RETRY_DELAY_MS);
};

export const setDisplaySetOrigin = (
  displaySetService: any,
  ids: string | string[],
  origin: CaseOrigin
) => {
  if (!displaySetService?.getDisplaySetByUID) {
    return;
  }

  normalizeIds(ids).forEach(uid => {
    if (!uid) {
      return;
    }

    try {
      const resolved = trySetOrigin(displaySetService, uid, origin);
      if (!resolved) {
        const existing = pendingOrigins.get(uid);
        if (!existing || origin === 'patient' || existing.origin !== 'patient') {
          pendingOrigins.set(uid, {
            origin: origin === 'patient' ? 'patient' : existing?.origin ?? origin,
            attempts: existing?.attempts ?? 0,
            displaySetService,
          });
        }
        scheduleOriginRetry();
      }
    } catch (error) {
      console.warn('setDisplaySetOrigin: unable to tag display set', error);
    }
  });
};
