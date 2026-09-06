export default function TransactionDocumentLoading(){
  return <div className="document-page">
    <div className="document-toolbar no-print"><span>Loading document…</span></div>
    <section className="document-sheet" aria-busy="true">
      <header className="document-header"><div><div className="eyebrow">EASYNET IT SOLUTIONS LIMITED</div><h1>Loading…</h1><div className="document-number">Please wait</div></div></header>
      <div className="document-meta">
        <div><span>Document</span><strong>Loading details…</strong></div>
        <div><span>Status</span><strong>Loading…</strong></div>
      </div>
      <div className="document-footer"><span>Fetching document and line items</span></div>
    </section>
  </div>;
}
