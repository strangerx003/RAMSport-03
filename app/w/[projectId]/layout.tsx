import { ProjectShell } from "@/components/ProjectShell";
import { MODULE_LIST, ROLES } from "@/lib/constants";
import { requireProject } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  const roleName = ROLES.find((r) => r.key === ctx.role)?.name ?? ctx.role;

  const items = MODULE_LIST.map((module) => {
    const grants = ctx.access(module.key);
    return {
      key: module.key,
      num: module.num,
      name: module.name,
      short: module.short,
      group: module.group,
      read: grants.read,
      write: grants.write,
    };
  });

  return (
    <ProjectShell
      projectId={ctx.project.id}
      projectName={ctx.project.name}
      projectCode={ctx.project.code}
      rev={ctx.project.rev}
      roleLabel={roleName}
      user={{
        id: ctx.user.id,
        company_id: ctx.user.company_id,
        email: ctx.user.email,
        name: ctx.user.name,
        role: ctx.user.role,
        company_name: ctx.user.company_name,
      }}
      items={items}
    >
      {children}
    </ProjectShell>
  );
}
