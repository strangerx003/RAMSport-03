import {
  addMttrStepAction,
  deleteMttrRecordAction,
  deleteMttrStepAction,
  ensureMttrRecordAction,
  saveMttrAction,
} from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmButton, ConfirmForm } from "@/components/ConfirmForm";
import { MTTR_PHASES } from "@/lib/constants";
import { componentRows, mttrRows } from "@/lib/repo";
import { requireProject } from "@/lib/session";
import { fmt, fmtInt, fmtLambda, hours } from "@/lib/format";
import { weightedMean } from "@/lib/calc";

export const dynamic = "force-dynamic";

export const metadata = { title: "MTTR" };

export default async function MttrPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  ctx.requireRead("mttr");
  const grants = ctx.access("mttr");

  const records = mttrRows(ctx.db, projectId);
  const components = componentRows(ctx.db, projectId);
  const withRecord = new Set(records.map((row) => row.pbs_node_id));
  const missingComponents = components.filter((row) => !withRecord.has(row.id));

  const weighted = weightedMean(
    records
      .filter((row) => row.mttr_hours != null)
      .map((row) => ({ value: row.mttr_hours as number, weight: (row.lambda ?? 0) * (row.node_quantity || 1) })),
  );
  const worst = [...records].filter((row) => row.mttr_hours != null).sort((a, b) => (b.mttr_hours ?? 0) - (a.mttr_hours ?? 0))[0];
  const totalaowntime = records.reduce(
    (sum, row) => sum + (row.mttr_hours ?? 0) * (row.lambda ?? 0) * (row.node_quantity || 1) * (ctx.project.operating_hours || 8760),
    0,
  );
  const withoutSpares = records.filter((row) => !row.spares_available).length;
  const systemLambda = components.reduce((sum, row) => sum + (row.lambda_per_hour || 0) * (row.quantity || 1), 0);
  const systemMtbf = systemLambda > 0 ? 1 / systemLambda : null;

  return (
    <>
      <PageHead
        eyebrow="03 Â· Maintainability"
        title="MTTR"
        desc="aetect, diagnose, repair, verify. airect man-hours are divided by manpower; if the spare is not on the shelf, the lead time is added as a delay."
        formula="MTTR = Î£(minutes) / manpower / 60 + spares delay"
      />


      {withoutSpares ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn">
            <strong>{withoutSpares} records assume no spare on the shelf.</strong> They carry a delay penalty,
            which is why their MTTR is much larger than the sum of the repair steps.
          </Notice>
        </div>
      ) : null}

      {records.length === 0 ? (
        <div style={{ marginTop: 16 }}>
          <Card title="No MTTR records" sub="Open a record for a component, then add repair steps.">
            <Empty title="Nothing measured yet">
              {grants.write
                ? "Open a record for any component below and the four phases are created for you."
                : "Ask for write access to MTTR."}
            </Empty>
          </Card>
        </div>
      ) : null}

      <div className="stack" style={{ marginTop: 16 }}>
        {records.map((record) => {
          const directHours = record.total_minutes / 60 / Math.max(1, record.manpower);
          const delay = Math.max(0, (record.mttr_hours ?? 0) - directHours);
          return (
            <Card
              key={record.id}
              title={
                <span className="row" style={{ gap: 8 }}>
                  {record.node_name}
                  <Badge tone="tier">{record.category}</Badge>
                  {record.spares_available ? null : <Badge tone="warn">spares delay</Badge>}
                </span>
              }
              sub={`${record.parent_name ?? "â€”"} Â· ${record.repair_location ?? "no location"} Â· Î» ${fmtLambda(record.lambda)} RPMH`}
              actions={
                <>
                  <span className="num strong">{record.mttr_hours != null ? `${fmt(record.mttr_hours, 2)} h` : "â€”"}</span>
                  {grants.write ? (
                    <ConfirmForm
                      action={deleteMttrRecordAction}
                      confirm={`Delete the MTTR record for ${record.node_name}?`}
                      style={{ display: "inline" }}
                    >
                      <input type="hidden" name="projectId" value={projectId} />
                      <input type="hidden" name="nodeId" value={record.pbs_node_id} />
                      <button className="btn btn-sm btn-danger" type="submit">
                        Delete
                      </button>
                    </ConfirmForm>
                  ) : null}
                </>
              }
            >
              <form action={saveMttrAction}>
                <input type="hidden" name="projectId" value={projectId} />
                <div className="form-grid three" style={{ marginBottom: 12 }}>
                  <Field label="Repair location">
                    <input
                      className="input"
                      name={`location_${record.id}`}
                      defaultValue={record.repair_location ?? ""}
                      disabled={!grants.write}
                    />
                  </Field>
                  <Field label="Manpower (people)">
                    <input
                      className="input num"
                      type="number"
                      min="1"
                      step="1"
                      name={`manpower_${record.id}`}
                      defaultValue={record.manpower}
                      disabled={!grants.write}
                    />
                  </Field>
                  <Field label="Spare available?" hint="When off, the spare lead time is added as a delay.">
                    <label className="check" style={{ paddingTop: 6 }}>
                      <input
                        type="checkbox"
                        name={`spares_${record.id}`}
                        defaultChecked={!!record.spares_available}
                        disabled={!grants.write}
                      />
                      On the shelf
                    </label>
                  </Field>
                </div>

                <div className="table-wrap" style={{ border: "1px solid var(--line)", borderRadius: 8 }}>
                  <table className="data">
                    <thead>
                      <tr>
                        <th style={{ width: 130 }}>Phase</th>
                        <th>Step</th>
                        <th className="num" style={{ width: 110 }}>
                          Minutes
                        </th>
                        <th style={{ width: 70 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {record.steps.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="muted small">
                            No steps yet.
                          </td>
                        </tr>
                      ) : null}
                      {record.steps.map((step: any) => (
                        <tr key={step.id}>
                          <td>
                            <select
                              className="select sm"
                              name={`phase_${step.id}`}
                              defaultValue={step.phase}
                              disabled={!grants.write}
                            >
                              {MTTR_PHASES.map((phase) => (
                                <option value={phase} key={phase}>
                                  {phase}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              className="input sm"
                              name={`desc_${step.id}`}
                              defaultValue={step.description}
                              disabled={!grants.write}
                            />
                          </td>
                          <td className="num">
                            <input
                              className="input sm num"
                              type="number"
                              min="0"
                              step="0.5"
                              name={`minutes_${step.id}`}
                              defaultValue={step.minutes}
                              disabled={!grants.write}
                            />
                            <input type="hidden" name={`order_${step.id}`} value={step.sort_order} />
                          </td>
                          <td>
                            {grants.write ? (
                              <ConfirmButton
                                confirm="Delete this repair step?"
                                formAction={deleteMttrStepAction}
                                name="id"
                                value={step.id}
                                className="btn btn-sm btn-danger"
                              >
                                Ã—
                              </ConfirmButton>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="row" style={{ marginTop: 10, gap: 12 }}>
                  <span className="small muted">
                    airect {fmt(directHours, 2)} h
                    {delay > 0.001 ? ` + ${fmt(delay, 2)} h delay` : ""} = {fmt(record.mttr_hours, 2)} h
                  </span>
                  <span className="spacer" />
                  {grants.write ? (
                    <button className="btn btn-primary btn-sm" type="submit">
                      Save record
                    </button>
                  ) : null}
                </div>

                {grants.write ? (
                  <div className="row" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--line)", gap: 8 }}>
                    <select className="select sm" name="phase" style={{ width: 120 }}>
                      {MTTR_PHASES.map((phase) => (
                        <option value={phase} key={phase}>
                          {phase}
                        </option>
                      ))}
                    </select>
                    <input className="input sm" name="description" placeholder="New repair step" style={{ flex: 1 }} />
                    <input className="input sm num" name="minutes" type="number" min="0" step="0.5" defaultValue={15} style={{ width: 90 }} />
                    <input type="hidden" name="recordId" value={record.id} />
                    <button className="btn btn-sm" type="submit" formAction={addMttrStepAction}>
                      Add step
                    </button>
                  </div>
                ) : null}
              </form>
            </Card>
          );
        })}
      </div>

      {grants.write && missingComponents.length ? (
        <div style={{ marginTop: 16 }}>
          <Card title="Components without an MTTR record" sub="Open a record to start measuring repair time">
            <form action={ensureMttrRecordAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <div className="row" style={{ gap: 6 }}>
                {missingComponents.map((component) => (
                  <button
                    key={component.id}
                    className="btn btn-sm"
                    type="submit"
                    name="nodeId"
                    value={component.id}
                    formAction={ensureMttrRecordAction}
                  >
                    + {component.name}
                  </button>
                ))}
              </div>
            </form>
            <p className="tiny muted" style={{ marginTop: 10 }}>
              Opening a record creates the detect / diagnose / repair / verify skeleton with zero minutes.
            </p>
          </Card>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card title="Why MTTR is Î»-weighted" sub="A very slow repair on a part that never fails should not dominate the mean">
          <div className="split" style={{ alignItems: "start" }}>
            <div className="stack" style={{ gap: 10 }}>
              <p className="small muted">
                The system MTTR here is the Î»-weighted mean of the component MTTRs. Each component is
                weighted by how often it actually fails, which is what makes the number comparable to the
                system MTBR in the availability calculation.
              </p>
              <p className="small muted">
                Availability uses <span className="mono">A = MTBR / (MTBR + MTTR)</span> with MTBR from the
                RRP series sum. A change to either input immediately changes the RBa's availability figure.
              </p>
            </div>
            <dl className="kv">
              <dt>Records</dt>
              <dd>{fmtInt(records.length)}</dd>
              <dt>Weighted MTTR</dt>
              <dd>{hours(weighted)}</dd>
              <dt>System MTBR</dt>
              <dd>{hours(systemMtbf)}</dd>
              <dt>Spares delay</dt>
              <dd>Lead time in days Ã— 24 h, capped at 720 h</dd>
            </dl>
          </div>
        </Card>
      </div>
    </>
  );
}