import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * The project root has no page of its own — the PBS is the entry point.
 * Keep the route so older bookmarks and links resolve instead of 404ing.
 */
export default async function ProjectIndexPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  redirect(`/w/${projectId}/pbs`);
}
