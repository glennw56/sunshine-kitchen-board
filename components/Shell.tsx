import Link from "next/link";
import { readSession } from "@/lib/session";
import { NameBar } from "./NameBar";

const TABS = [
  { href: "/", label: "Board" },
  { href: "/raw", label: "Raw" },
  { href: "/cooked", label: "Cooked" },
  { href: "/live", label: "Live" },
];

export async function Shell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  const session = await readSession();
  return (
    <div className="shell">
      <header className="top">
        <div>
          <h1 className="brand">Sunshine</h1>
          <p className="sub">Kitchen board · America/Chicago</p>
        </div>
        <NameBar name={session.staffName} admin={session.adminEmail} />
      </header>
      {children}
      <nav className="tabs" aria-label="Main">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className={active === tab.href ? "active" : ""}>
            {tab.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
