import { Shell } from "@/components/Shell";
import { LiveClient } from "@/components/LiveClient";
import { loadLiveFeed } from "@/lib/timeclock/client";
import { defaultStore } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function LivePage() {
  const feed = await loadLiveFeed({ store: defaultStore(), kitchenOnly: true });
  return (
    <Shell active="/live">
      <LiveClient initial={feed} />
    </Shell>
  );
}
