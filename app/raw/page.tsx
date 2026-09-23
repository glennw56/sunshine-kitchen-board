import { Shell } from "@/components/Shell";
import { RawClient } from "@/components/RawClient";
import { inventoryViews } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function RawPage() {
  const view = await inventoryViews();
  return (
    <Shell active="/raw">
      <RawClient
        items={view.raw}
        all={view.items}
        recipes={view.recipes}
        error={view.error}
        transport={view.transport}
        health={view.health}
      />
    </Shell>
  );
}
