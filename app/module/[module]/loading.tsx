export default function ModuleLoading() {
  return <div className="ef-route-loading" role="status" aria-live="polite">
    <span className="ef-navigation-spinner" aria-hidden="true" />
    <span>Loading module…</span>
  </div>;
}
