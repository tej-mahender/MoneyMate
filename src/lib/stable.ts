/** One shared, never-mutated empty list for `useLiveQuery(...) ?? EMPTY_LIST`.
 *
 *  A literal `?? []` creates a brand-new array on every render while a query
 *  is still loading, so anything memoized on it (useMemo/useEffect deps)
 *  re-runs every time. A single stable reference avoids that. */
export const EMPTY_LIST: never[] = [];
