import Link from "next/link";
import { Shell } from "@/components/Shell";
import { OwnerClient } from "@/components/OwnerClient";
import { boardSnapshot } from "@/lib/board";
import { readSession } from "@/lib/session";
import { formatChicago } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function OwnerPage() {
  const session = await readSession();
  if (!session.adminEmail) {
    return (
      <Shell active="/">
        <section className="card">
          <h2>Owner</h2>
          <p>Sign in to see the activity log and alert settings.</p>
          <Link className="btn" href="/login">Owner login</Link>
        </section>
      </Shell>
    );
  }
  const data = await boardSnapshot();
  return (
    <Shell active="/">
      <OwnerClient
        settings={data.settings}
        cards={data.cards.map((card) => ({
          id: card.ticket.id,
          name: card.recipe?.name ?? card.ticket.recipeId,
          dueAt: card.ticket.dueAt,
          dueLabel: formatChicago(card.ticket.dueAt),
          status: card.ticket.status,
          assignee: card.ticket.assignee,
          timing: card.timing,
        }))}
        activity={data.activity.map((entry) => ({
          id: entry.id,
          at: formatChicago(entry.at),
          actor: entry.actor,
          action: entry.action,
          detail: entry.detail,
        }))}
        floor={data.onTheFloor}
      />
    </Shell>
  );
}
