"use client";

import dynamic from "next/dynamic";

import type { ProjectEstimateCostCodeOption } from "@/app/actions/project-estimates";

const ProjectEstimatePlanSwiftImportClient = dynamic(
  () =>
    import("@/components/projects/project-estimate-planswift-import-client").then(
      (module) => module.ProjectEstimatePlanSwiftImportClient,
    ),
  { ssr: false },
);

export function ProjectEstimatePlanSwiftImport({
  projectId,
  estimateId,
  costCodes,
  existingLineCount,
}: {
  readonly projectId: string;
  readonly estimateId: string;
  readonly costCodes: readonly ProjectEstimateCostCodeOption[];
  readonly existingLineCount: number;
}): React.ReactElement {
  return (
    <ProjectEstimatePlanSwiftImportClient
      projectId={projectId}
      estimateId={estimateId}
      costCodes={costCodes}
      existingLineCount={existingLineCount}
    />
  );
}
