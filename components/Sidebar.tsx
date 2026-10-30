"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SidebarItem = {
  key: string;
  num: string;
  name: string;
  short: string;
  group: string;
  read: boolean;
  write: boolean;
};

const GROUP_ORDER = ["Structure", "Analysis", "Safety", "Operations", "Output"];

export function Sidebar({
  projectId,
  projectName,
  projectCode,
  rev,
  items,
  onNavigate,
}: {
  projectId: string;
  projectName: string;
  projectCode: string | null;
  rev: number;
  items: SidebarItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname() || "";
  const base = `/w/${projectId}`;

  return (
    <aside className="sidebar" id="project-nav" aria-label="Project navigation">
      <Link href="/projects" className="brand" style={{ textDecoration: "none" }} onClick={onNavigate}>
        <div className="brand-mark">R</div>
        <div>
          <div className="brand-name">RAMSport03</div>
          <div className="brand-sub">Analysis workspace</div>
        </div>
      </Link>

      <div className="side-project">
        <Link href={`${base}/pbs`} onClick={onNavigate}>
          {projectName}
        </Link>
        <div className="meta">
          {projectCode ? `${projectCode} · ` : ""}rev {rev}
        </div>
      </div>

      <nav className="nav">
        {GROUP_ORDER.map((group) => {
          const groupItems = items.filter((item) => item.group === group);
          if (!groupItems.length) return null;
          return (
            <div className="nav-group" key={group}>
              <div className="nav-label">{group}</div>
              {groupItems.map((item) => {
                const href = `${base}/${item.key}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                if (!item.read) {
                  return (
                    <span className="nav-item locked" key={item.key} title="Not licensed or not granted for this project">
                      <span className="nav-num">{item.num}</span>
                      <span>{item.short}</span>
                      <span className="nav-lock">locked</span>
                    </span>
                  );
                }
                return (
                  <Link
                    key={item.key}
                    href={href}
                    className={`nav-item${active ? " active" : ""}`}
                    title={item.name}
                    onClick={onNavigate}
                  >
                    <span className="nav-num">{item.num}</span>
                    <span>{item.short}</span>
                    {!item.write ? <span className="nav-lock" title="Read-only">R</span> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}

        <div className="nav-group">
          <div className="nav-label">Manage</div>
          <Link
            href={`${base}/import`}
            className={`nav-item${pathname.startsWith(`${base}/import`) ? " active" : ""}`}
            onClick={onNavigate}
          >
            <span className="nav-num">↧</span>
            <span>Import</span>
          </Link>
          <Link
            href={`${base}/settings`}
            className={`nav-item${pathname.startsWith(`${base}/settings`) ? " active" : ""}`}
            onClick={onNavigate}
          >
            <span className="nav-num">⚙</span>
            <span>Settings</span>
          </Link>
        </div>
      </nav>

      <div className="side-foot">
        <div>{items.length} linked modules · rev {rev}</div>
        <div style={{ marginTop: 4 }}>
          <Link href="/projects" onClick={onNavigate}>
            All projects
          </Link>
        </div>
      </div>
    </aside>
  );
}
