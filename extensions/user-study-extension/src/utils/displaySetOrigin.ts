export type CaseOrigin = 'patient' | 'ai';

const normalizeIds = (value: string | string[] | null | undefined): string[] => {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value.filter(Boolean) : [value];
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
      const displaySet = displaySetService.getDisplaySetByUID(uid);
      if (!displaySet) {
        return;
      }

      if (origin === 'patient') {
        (displaySet as any).__caseOrigin = 'patient';
        return;
      }

      if ((displaySet as any).__caseOrigin === 'patient') {
        return;
      }

      (displaySet as any).__caseOrigin = 'ai';
    } catch (error) {
      console.warn('setDisplaySetOrigin: unable to tag display set', error);
    }
  });
};
