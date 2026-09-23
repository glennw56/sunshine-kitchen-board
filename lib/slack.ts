import { createHmac, timingSafeEqual } from "crypto";
import { publicBaseUrl, slackAssigneeMap, slackConfig } from "./config";
import type { Recipe, Ticket } from "./types";
import { formatChicago } from "./time";

export function verifySlackSignature(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const cfg = slackConfig();
  if (!cfg) return false;
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 60 * 5) return false;
  const base = `v0:${timestamp}:${rawBody}`;
  const digest = `v0=${createHmac("sha256", cfg.signingSecret).update(base).digest("hex")}`;
  const a = Buffer.from(digest);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function postKitchenMessage(text: string, extra?: string): Promise<{ ok: boolean; error: string | null }> {
  const cfg = slackConfig();
  if (!cfg) return { ok: false, error: "Slack is not configured (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET, SLACK_CHANNEL_ID)" };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: cfg.channelId,
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        ...(extra ? [{ type: "context", elements: [{ type: "mrkdwn", text: extra }] }] : []),
      ],
    }),
  });
  const body = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok === false) {
    return { ok: false, error: body.error || `Slack HTTP ${res.status}` };
  }
  return { ok: true, error: null };
}

export function recipeSlackText(recipe: Recipe, ticket: Ticket | null): string {
  const due = ticket ? formatChicago(ticket.dueAt) : recipe.defaultDueTime;
  const lines = [
    `*${recipe.name}*`,
    `Batch: ${recipe.batchSize} ${recipe.batchUnit} · yield ${recipe.yieldQty} · prep ${recipe.prepMinutes} min`,
    ticket ? `Due: ${due} · status ${ticket.status}${ticket.assignee ? ` · ${ticket.assignee}` : ""}` : `Usual due: ${due}`,
    "",
    "*Ingredients*",
    ...recipe.ingredients.map((line) => `• ${line.qty} ${line.unit} ${line.name} \`${line.sku}\``),
    "",
    "*Steps*",
    ...recipe.steps.map((step, index) => {
      const station = step.station ? ` · ${step.station}` : "";
      const stock = step.movesStock ? " · moves stock" : "";
      return `${index + 1}. ${step.text} (${step.minutes} min${station}${stock})`;
    }),
  ];
  if (ticket) {
    const base = publicBaseUrl();
    lines.push("", base ? `<${base}/?ticket=${ticket.id}|Open this ticket on the board>` : "Open the kitchen board to claim, start, or finish.");
  }
  return lines.join("\n");
}

export function mentionFor(assignee: string | null): string {
  if (!assignee) return "";
  const map = slackAssigneeMap();
  const id = map[assignee];
  return id ? ` <@${id}>` : "";
}
