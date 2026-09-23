import { Shell } from "@/components/Shell";
import { BoardClient } from "@/components/BoardClient";
import { boardSnapshot } from "@/lib/board";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const data = await boardSnapshot();
  return (
    <Shell active="/">
      <BoardClient initial={data} />
    </Shell>
  );
}
