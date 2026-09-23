export type Station = "proofer" | "oven" | "fridge";

export type RecipeIngredient = {
  id: string;
  sku: string;
  name: string;
  qty: number;
  unit: string;
};

export type RecipeStep = {
  id: string;
  text: string;
  minutes: number;
  station: Station | null;
  /** Shown on the card. Stock actually moves when the ticket is marked done. */
  movesStock: boolean;
};

export type Recipe = {
  id: string;
  name: string;
  finishedSku: string;
  finishedName: string;
  /** Units of finished goods added to inventory per one batch. */
  yieldQty: number;
  batchSize: number;
  batchUnit: string;
  prepMinutes: number;
  /** America/Chicago HH:mm used when seeding today's ticket. */
  defaultDueTime: string;
  ingredients: RecipeIngredient[];
  steps: RecipeStep[];
};

export type TicketStatus = "open" | "claimed" | "started" | "done";

export type Ticket = {
  id: string;
  recipeId: string;
  /** Chicago calendar date YYYY-MM-DD */
  serviceDate: string;
  dueAt: string;
  /** How many recipe batches this ticket covers. */
  batches: number;
  status: TicketStatus;
  assignee: string | null;
  claimedAt: string | null;
  startedAt: string | null;
  doneAt: string | null;
  shortageAck: boolean;
  stockMoved: boolean;
  squareMoved: boolean;
  squareError: string | null;
  createdAt: string;
};

export type ActivityAction =
  | "claim"
  | "start"
  | "done"
  | "transfer"
  | "nudge"
  | "overdue-alert"
  | "raw-adjust"
  | "cooked-add"
  | "cooked-remove"
  | "cooked-pull"
  | "link-sku"
  | "due-change"
  | "square-retry";

export type ActivityEntry = {
  id: string;
  at: string;
  actor: string;
  action: ActivityAction;
  ticketId?: string;
  detail: string;
};

export type AlertState = {
  ticketId: string;
  count: number;
  lastSentAt: string | null;
  lastError: string | null;
};

export type Settings = {
  overdueBufferMinutes: number;
  realertMinutes: number;
};

export type CatalogItem = {
  sku: string;
  name: string;
  onHand: number;
  unit: string;
  category: string;
  /** Which numeric field to write back when the source document is updated. */
  qtyKey?: string;
};

export type ShortageLine = {
  sku: string;
  name: string;
  need: number;
  onHand: number;
  unit: string;
  missingSku: boolean;
};

export type PunchRoleKind = "kitchen" | "foh" | "other" | "untagged";

export type LivePerson = {
  userId: string;
  name: string;
  username: string;
  email: string | null;
  store: string;
  role: string;
  roleKind: PunchRoleKind;
  clockIn: string;
  status: "open" | "closed";
  clockOut: string;
  hours: string;
  source: string;
  punchId: string;
};

export type LiveFeed = {
  ok: boolean;
  error: string | null;
  sourceUrl: string;
  fetchedAt: string;
  storeFilter: string;
  stores: string[];
  punchedIn: LivePerson[];
  recent: LivePerson[];
  hiddenOtherCount: number;
};
