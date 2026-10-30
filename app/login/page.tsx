import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAction } from "@/lib/actions";
import { getSessionUser } from "@/lib/session";

export const metadata = { title: "Login" };

// Demo accounts for quick login
export const DEMO = [
  { email: "admin@relialedger.app", name: "Maya Iyer", role: "Company Admin", note: "Full access, can enable modules", password: "demo1234" },
  { email: "analyst@relialedger.app", name: "Priya Raman", role: "Analyst", note: "Write to PBS, Register, FMEA", password: "demo1234" },
  { email: "reviewer@relialedger.app", name: "Tom Beckett", role: "Reviewer", note: "Read‑only everywhere", password: "demo1234" },
  { email: "username-test", name: "Test User", role: "Tester", note: "Testing credentials", password: "password-test" },
];

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string }> }) {
  const user = await getSessionUser();
  if (user) redirect("/projects");
  const params = await searchParams;
  const error = params.error === "1";

  return (
    <div className="login-page">
        <div className="auth">

      <div className="auth-art">
        <div className="brand" style={{ padding: 0, border: 0 }}>
          <div className="brand-mark">R</div>
          <div>
            <div className="brand-name">RAMSport03</div>
            <div className="brand-sub">Reliability · Availability · Maintainability · Safety</div>
          </div>
        </div>
        <h1>Reliability analysis that can prove itself.</h1>
        <p>
          Twelve linked modules model the data flow. Change a failure rate, see the impact on criticality,
          hazard, cut set and report recompute — with the revision that used it.
        </p>
        <ul className="auth-bullets">
          {[
            "λ per component, propagated to FMECA, FTA, RBD and spares",
            "MIL‑STD‑1629A criticality and IEC‑61078 block diagrams, done correctly",
            "Freeze‑frame report snapshots — a reviewer can always reproduce a number",
            "Excel‑first: every grid imports, every report exports",
          ].map((line, i) => (
            <li key={i} className="auth-bullet" data-i={String(i).padStart(2, "0")}>
              <span className="auth-tick">✓</span> {line}
            </li>
          ))}
        </ul>
      </div>
      <div className="auth-foot">
        Clean‑room implementation · IEC‑61078 · MIL‑STD‑1629A · MIL‑HDBK‑217F part‑stress method
      </div>
    </div>
    <div className="auth-form-wrap">
      <div className="auth-card">
        <h2>Login</h2>
        <p className="sub">Use the seeded demo accounts or your own credentials.</p>
        {error && <div className="auth-error">That email and password combination did not match.</div>}
        <form action={signInAction} className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input
              className="input"
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              placeholder="username-test"
              defaultValue={params.email ?? "admin@relialedger.app"}
              required
            />
            <div className="hint" style={{ fontSize: "0.75rem", color: "#666" }}>Testing user: <strong>username-test</strong></div>
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              className="input"
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="password-test"
              defaultValue="demo1234"
              required
            />
            <div className="hint" style={{ fontSize: "0.75rem", color: "#666" }}>Testing password: <strong>password-test</strong></div>
          </div>
          <button className="btn btn-primary" type="submit" style={{ width: "100%", padding: "9px 12px" }}>
            Sign in
          </button>
        </form>
        <div className="demo-box">
          <span className="label">One‑click demo accounts · password demo1234</span>
          {DEMO.map((demo) => (
            <form action={signInAction} key={demo.email}>
              <input type="hidden" name="email" value={demo.email} />
              <input type="hidden" name="password" value={demo.password} />
              <button className="demo-btn" type="submit">
                <b>{demo.name}</b> <span className="muted">· {demo.role} — {demo.note}</span>
              </button>
            </form>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 16 }}>
          <Link href="/login">RAMSport03</Link> · local demo environment, data stored in
          <span className="muted"> data/relialedger.db</span>
        </p>
      </div>
    </div>
    </div>
  );
}
