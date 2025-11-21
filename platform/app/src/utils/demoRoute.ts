export const DEMO_ROUTE_PATH = '/user-study-mode';
export const DEMO_STUDY_INSTANCE_UID = '678543127898756';

/**
 * Checks whether the current location matches the public demo route.
 */
export function isDemoRoute(pathname: string, search: string): boolean {
  if (pathname !== DEMO_ROUTE_PATH) {
    return false;
  }

  const params = new URLSearchParams(search);
  return params.get('StudyInstanceUIDs') === DEMO_STUDY_INSTANCE_UID;
}
