/** Neutral fallback for route transitions; never display dashboard-like placeholder cards. */
export default function Loading() {
  return (
    <div className="ef-route-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="ef-navigation-spinner" aria-hidden="true" />
      <span>Loading page…</span>
    </div>
  );
}
