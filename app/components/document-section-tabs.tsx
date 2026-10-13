import Link from "next/link";

export type DocumentTab = { id: string; label: string; href: string; external?: boolean };

/** Navigation only; shows actual sections/links, not empty or simulated panels. */
export default function DocumentSectionTabs({ tabs }: { tabs: readonly DocumentTab[] }) {
  if (tabs.length < 2) return null;
  return <nav className="document-flow-tabs no-print" aria-label="Document sections">
    <div className="document-flow-tab-row" style={{ gap: 8, flexWrap: "wrap" }}>
      {tabs.map(tab => <Link
        key={tab.id}
        prefetch={false}
        href={tab.href}
        className="button-link secondary-link"
        aria-label={tab.external ? `Open ${tab.label}` : `Jump to ${tab.label}`}
      >{tab.label}{tab.external ? " ↗" : ""}</Link>)}
    </div>
  </nav>;
}
