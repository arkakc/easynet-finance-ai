import MasterDoctypeClient from "@/app/components/master-doctype-client";

export const dynamic = "force-dynamic";

export default function ProjectMasterPage() {
  return (
    <MasterDoctypeClient
      type="project"
      title="Projects"
      description="Project master doctype used by Sales, Purchase, expenses, job costing, and project profitability reports."
      createLabel="+ Create New Project"
    />
  );
}
