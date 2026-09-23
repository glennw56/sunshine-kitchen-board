import { loadLiveFeed } from "@/lib/timeclock/client";
import { fail, json } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const store = url.searchParams.get("store") || undefined;
    const kitchenOnly = url.searchParams.get("kitchenOnly") !== "0";
    const feed = await loadLiveFeed({ store, kitchenOnly });
    return json(feed);
  } catch (error) {
    return fail(error, 500);
  }
}
