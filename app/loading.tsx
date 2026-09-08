export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite">
      <div className="page-head">
        <div>
          <h2>Loading…</h2>
          <p className="small">The page is ready. Live data is loading from the backend.</p>
        </div>
        <div className="badge">LIVE DATA</div>
      </div>

      <div className="grid dashboard-grid">
        {[0, 1, 2, 3].map((item) => (
          <div className="card" key={item}>
            <div className="label">Loading value</div>
            <div className="value">—</div>
          </div>
        ))}
      </div>

      <section className="panel">
        <strong>Loading live data…</strong>
        <p className="small">Navigation and page chrome render first; backend values follow without blocking the initial page view.</p>
      </section>
    </div>
  );
}
