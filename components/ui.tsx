import type { ReactNode } from "react";

type Tone = "neutral" | "info" | "ok" | "warn" | "danger" | "dark" | "tier";

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`badge badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function PageHead({
  eyebrow,
  title,
  desc,
  formula,
  children,
}: {
  eyebrow: string;
  title: string;
  desc?: ReactNode;
  formula?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="page-title">{title}</h1>
        {desc ? <p className="page-desc">{desc}</p> : null}
        {formula ? (
          <div style={{ marginTop: 9 }}>
            <span className="formula">{formula}</span>
          </div>
        ) : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </div>
  );
}

export function Card({
  title,
  sub,
  actions,
  children,
  body = "pad",
  style,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  body?: "pad" | "tight" | "none";
  style?: React.CSSProperties;
}) {
  return (
    <section className="card" style={style}>
      {title || actions ? (
        <div className="card-head">
          <div>
            {title ? <div className="card-title">{title}</div> : null}
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="spacer row" style={{ gap: 8 }}>{actions}</div> : null}
        </div>
      ) : null}
      {body === "none" ? children : <div className={body === "tight" ? "card-body tight" : "card-body"}>{children}</div>}
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  foot,
  tone,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: string;
  foot?: ReactNode;
  tone?: "ok" | "warn" | "danger";
  hint?: string;
}) {
  const color = tone === "danger" ? "var(--danger)" : tone === "warn" ? "var(--warn)" : tone === "ok" ? "var(--ok)" : undefined;
  return (
    <div className="kpi" title={hint}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color }}>
        {value}
        {unit ? <span className="unit">{unit}</span> : null}
      </div>
      {foot ? <div className="kpi-foot">{foot}</div> : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  span,
  style,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  span?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div className={span ? "field span-2" : "field"} style={style}>
      <label>{label}</label>
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Meter({ value, tone }: { value: number; tone?: "ok" | "warn" | "danger" }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="bar">
      <div className={`bar-fill${tone ? ` ${tone}` : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "ok" | "warn" | "danger";
  children: ReactNode;
}) {
  return <div className={`alert alert-${tone}`}>{children}</div>;
}

export function KeyValues({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}
