import { json } from "@/lib/api";
import { DEPLOY_SERVICE } from "@/lib/constants";
import { inventoryBaseUrl, timeclockBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({
    ok: true,
    service: process.env.K_SERVICE || DEPLOY_SERVICE,
    timeZone: "America/Chicago",
    inventory: inventoryBaseUrl(),
    timeclock: timeclockBaseUrl(),
  });
}
