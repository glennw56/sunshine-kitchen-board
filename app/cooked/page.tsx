import { Shell } from "@/components/Shell";
import { CookedClient } from "@/components/CookedClient";
import { inventoryViews } from "@/lib/board";
import { readTestCookCount } from "@/lib/square";
import { SQUARE_TEST_COOK } from "@/lib/constants";

export const dynamic = "force-dynamic";

export default async function CookedPage() {
  const view = await inventoryViews();
  const square = await readTestCookCount().catch((error: unknown) => ({
    ok: false,
    quantity: null as string | null,
    error: error instanceof Error ? error.message : String(error),
  }));
  return (
    <Shell active="/cooked">
      <CookedClient
        items={view.cooked}
        error={view.error}
        transport={view.transport}
        square={{ ...square, label: `${SQUARE_TEST_COOK.name} · ${SQUARE_TEST_COOK.sku}` }}
      />
    </Shell>
  );
}
