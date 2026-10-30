import Link from "next/link";
import { addFmeaRowAction, deleteFmeaRowAction, saveFmeaRowsAction } from "@/lib/actions";
import { Badge, Card, Empty, Field, Notice, PageHead } from "@/components/ui";
import { ConfirmButton } from "@/components/ConfirmForm";
import { componentRows, fmeaRows } from "@/lib/repo";
import { requireProject } from "@/lib/session";
import { fmt, fmtInt, fmtLambda, hours } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "FMECA" };

export default async function FmecaPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProject(projectId);
  ctx.requireRead("fmeca");
  const grants = ctx.access("fmeca");

  const rows = fmeaRows(ctx.db, projectId, "fmeca");
  const components = componentRows(ctx.db, projectId);
  const totalCm = rows.reduce((sum, row) => sum + (row.cm ?? 0), 0);
  const stale = rows.filter((row) => row.stale).length;
  const top = rows[0];
  const defaultT = Math.round((ctx.project.operating_hours || 8760) * (ctx.project.product_life_years || 10));
  const modes = new Set(rows.map((row) => row.failure_mode)).size;

  return (
    <>
      <PageHead
        eyebrow="05 Â· FMECA"
        title="Criticality analysis"
        desc="MIL-STD-1629A mode criticality, priced from the live FRP Î». Cm is per item; assembly totals carry the line quantity. Change a failure rate and every Cm, rank and downstream maintenance trigger follows."
        formula="Cm = Î² Â· Î± Â· Î» Â· T   Â·   Cr = Î£ Cm"
      >
        <Link className="btn" href={`/w/${projectId}/dfmea`}>
          DFMEA â†’
        </Link>
        <Link className="btn" href={`/w/${projectId}/pm`}>
          Generate PM â†’
        </Link>
      </PageHead>


      {stale ? (
        <div style={{ marginTop: 14 }}>
          <Notice tone="warn">
            <strong>{stale} rows carry an older Î».</strong> Saving this grid re-prices every row from the
            current Data Register values.
          </Notice>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Card
          title="Criticality grid"
          sub="Î± = conditional probability of the end effect Â· Î² = conditional probability of the failure mode given the failure"
          body="tight"
        >
          {rows.length === 0 ? (
            <Empty title="No FMECA rows yet">Add a failure mode below to start the criticality analysis.</Empty>
          ) : (
            <form action={saveFmeaRowsAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="kind" value="fmeca" />
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th className="num" style={{ width: 40 }}>Cr</th>
                      <th style={{ minWidth: 150 }}>Component</th>
                      <th style={{ minWidth: 170 }}>Failure mode</th>
                      <th style={{ minWidth: 150 }}>Cause</th>
                      <th style={{ minWidth: 130 }}>Local effect</th>
                      <th style={{ minWidth: 130 }}>End effect</th>
                      <th className="num" style={{ width: 70 }}>Î±</th>
                      <th className="num" style={{ width: 70 }}>Î²</th>
                      <th className="num" style={{ width: 90 }}>T (h)</th>
                      <th className="num" style={{ width: 94 }}>Î» /10â¶h</th>
                      <th className="num" style={{ width: 90 }}>Cm</th>
                      <th style={{ minWidth: 150 }}>Action</th>
                      <th style={{ minWidth: 110 }}>Owner</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className={row.stale ? "stale" : undefined}>
                        <td className="num muted">{row.cr_rank ?? "â€”"}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.node_name}</div>
                          <div className="mono tiny muted">{row.part_number ?? "â€”"}</div>
                        </td>
                        <td>
                          <input className="inline-input" name={`mode_${row.id}`} defaultValue={row.failure_mode} disabled={!grants.write} />
                        </td>
                        <td>
                          <input className="inline-input" name={`cause_${row.id}`} defaultValue={row.cause ?? ""} disabled={!grants.write} />
                        </td>
                        <td>
                          <input className="inline-input" name={`local_${row.id}`} defaultValue={row.local_effect ?? ""} disabled={!grants.write} />
                        </td>
                        <td>
                          <input className="inline-input" name={`end_${row.id}`} defaultValue={row.end_effect ?? ""} disabled={!grants.write} />
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            name={`alpha_${row.id}`}
                            defaultValue={row.alpha ?? 0.5}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            name={`beta_${row.id}`}
                            defaultValue={row.beta ?? 1}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num">
                          <input
                            className="input sm num"
                            type="number"
                            min="0"
                            step="100"
                            name={`t_${row.id}`}
                            defaultValue={row.mission_t ?? defaultT}
                            disabled={!grants.write}
                          />
                        </td>
                        <td className="num">
                          <span
                            title={
                              row.stale
                                ? `Priced with an older Î» at revision ${row.priced_rev ?? "?"}`
                                : `Priced at revision ${row.priced_rev ?? "?"} from the current FRP Î»`
                            }
                          >
                            {fmtLambda(row.lambda_used)}
                            {row.stale ? " *" : ""}
                          </span>
                        </td>
                        <td className="num strong">{fmt(row.cm, 4)}</td>
                        <td>
                          <input className="inline-input" name={`action_${row.id}`} defaultValue={row.action ?? ""} disabled={!grants.write} />
                        </td>
                        <td>
                          <input className="inline-input" name={`owner_${row.id}`} defaultValue={row.action_owner ?? ""} disabled={!grants.write} />
                        </td>
                        <td>
                          {grants.write ? (
                            <ConfirmButton
                              confirm={`Delete the failure mode "${row.failure_mode}"?`}
                              formAction={deleteFmeaRowAction}
                              name="id"
                              value={row.id}
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
              {grants.write ? (
                <div className="savebar">
                  <span>
                    Cm is per item: Î² Â· Î± Â· Î» Â· T for one unit. A line quantity of three carries three
                    times the rate in the system totals, not three times this ranking. Ranks run across the
                    whole grid.
                  </span>
                  <span className="spacer" />
                  <button className="btn btn-primary btn-sm" type="submit">
                    Save FMECA
                  </button>
                </div>
              ) : null}
            </form>
          )}
        </Card>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        {grants.write ? (
          <Card title="Add a failure mode" sub="Mission window defaults to operating hours Ã— product life">
            <form action={addFmeaRowAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="kind" value="fmeca" />
              <div className="form-grid">
                <Field label="Component" span>
                  <select className="select" name="nodeId" required defaultValue="">
                    <option value="" disabled>
                      Choose a componentâ€¦
                    </option>
                    {components.map((component) => (
                      <option value={component.id} key={component.id}>
                        {component.name}
                        {component.lambda_per_hour != null ? ` Â· Î» ${fmtLambda(component.lambda_per_hour)}` : " Â· no Î»"}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Failure mode" span>
                  <input className="input" name="failureMode" placeholder="e.g. Switch short circuit" required />
                </Field>
                <Field label="Cause">
                  <input className="input" name="cause" />
                </Field>
                <Field label="Local effect">
                  <input className="input" name="localEffect" />
                </Field>
                <Field label="End effect" span>
                  <input className="input" name="endEffect" />
                </Field>
                <Field label="Î± â€” conditional probability" hint="0â€“1, fraction of component failures with this mode">
                  <input className="input num" type="number" min="0" max="1" step="0.05" name="alpha" defaultValue={0.5} />
                </Field>
                <Field label="Î² â€” effect probability" hint="0â€“1, probability the end effect follows">
                  <input className="input num" type="number" min="0" max="1" step="0.05" name="beta" defaultValue={1} />
                </Field>
                <Field label="Mission window T (h)">
                  <input className="input num" type="number" min="0" step="100" name="missionT" defaultValue={defaultT} />
                </Field>
                <Field label="Action">
                  <input className="input" name="action" />
                </Field>
                <Field label="Action owner">
                  <input className="input" name="actionOwner" />
                </Field>
              </div>
              <div className="row end" style={{ marginTop: 12 }}>
                <button className="btn btn-primary btn-sm" type="submit">
                  Add failure mode
                </button>
              </div>
            </form>
          </Card>
        ) : (
          <Card title="Read-only access">
            <p className="small muted">You can read this criticality analysis but not change it.</p>
          </Card>
        )}

        <Card title="Criticality at a glance" sub="What the numbers are telling you">
          <dl className="kv">
            <dt>Î£ Cm</dt>
            <dd>{fmt(totalCm, 4)}</dd>
            <dt>Rows</dt>
            <dd>{fmtInt(rows.length)}</dd>
            <dt>Components represented</dt>
            <dd>{fmtInt(new Set(rows.map((r) => r.pbs_node_id)).size)}</dd>
            <dt>Top mode</dt>
            <dd>{top?.failure_mode ?? "â€”"}</dd>
            <dt>Rows with actions</dt>
            <dd>{fmtInt(rows.filter((row) => row.action).length)}</dd>
          </dl>
          <p className="tiny muted" style={{ marginTop: 12 }}>
            Ranks are dense: every row gets a position, so two rows with the same Cm still have a
            defined order. FMECA rows with a defined action can seed the preventive maintenance plan.
          </p>
        </Card>
      </div>
    </>
  );
}