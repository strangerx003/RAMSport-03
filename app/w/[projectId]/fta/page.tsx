import Link from "next/link";
import { Badge, PageHead } from "@/components/ui";
import DiagramWorkbench from "@/components/workspace/DiagramWorkbench";
import { requireProject } from "@/lib/session";
import { readWorkspace, workspaceComponents, workspaceMeta } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fault Tree" };

export default async function FtaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  ctx.requireRead("fta");
  const grants = ctx.access("fta");

  const components = workspaceComponents(ctx.db, projectId);
  const meta = workspaceMeta(ctx.db, projectId, "fta", Number(ctx.project.mission_hours) || 8760);
  const state = readWorkspace(ctx.db, projectId, "fta", components, meta.missionHours);

  return (
    <>
      <PageHead
        eyebrow="09 Â· Fault Tree Analysis"
        title={meta.title}
        desc="Drag events and logic gates onto the canvas, connect causes upward into their effect and calculate the top-event probability for the current mission time."
        formula="IEC 61025 Â· Q(t) = 1 âˆ’ e^(âˆ’Î»t) Â· AND: Q = Î Qi Â· OR: Q = 1 âˆ’ Î (1 âˆ’ Qi)"
      >
        <Badge tone={grants.write ? "ok" : "neutral"}>{grants.write ? "Editable" : "Read only"}</Badge>


        <Link className="btn btn-ghost btn-sm" href={`/w/${projectId}/safety`}>\n          Hazards\n        </Link>


      </PageHead>

      <DiagramWorkbench
        projectId={projectId}
        mode="fta"
        title={meta.title}
        missionHours={meta.missionHours}
        components={components}
        initialState={state}
        canWrite={grants.write}
      />
    </>
  );
}