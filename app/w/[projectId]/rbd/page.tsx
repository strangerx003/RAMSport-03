import Link from "next/link";
import { Badge, PageHead } from "@/components/ui";
import DiagramWorkbench from "@/components/workspace/DiagramWorkbench";
import { requireProject } from "@/lib/session";
import { readWorkspace, workspaceComponents, workspaceMeta } from "@/lib/workspace/store";

export const dynamic = "force-dynamic";

export const metadata = { title: "RBD" };

export default async function RbdPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  ctx.requireRead("rbd");
  const grants = ctx.access("rbd");

  const components = workspaceComponents(ctx.db, projectId);
  const meta = workspaceMeta(ctx.db, projectId, "rbd", Number(ctx.project.mission_hours) || 8760);
  const state = readWorkspace(ctx.db, projectId, "rbd", components, meta.missionHours);

  return (
    <>
      <PageHead
        eyebrow="10 Â· Reliability Block Diagram"
        title={meta.title}
        desc="Drag blocks from the PBS component library onto the canvas, connect them in the required flow and calculate the equivalent system reliability, availability and MTBF."
        formula="IEC 61078 Â· Î»s = Î£Î»i Â· MTTRs = Î£(Î»i Ã— MTTRi) / Î»s Â· MTBFs = 1 / Î»s"
      >
        <Badge tone={grants.write ? "ok" : "neutral"}>{grants.write ? "Editable" : "Read only"}</Badge>



        <Link className="btn btn-ghost btn-sm" href={`/w/${projectId}/mttr`}>
          MTTR
        </Link>
      </PageHead>

      <DiagramWorkbench
        projectId={projectId}
        mode="rbd"
        title={meta.title}
        missionHours={meta.missionHours}
        components={components}
        initialState={state}
        canWrite={grants.write}
      />
    </>
  );
}