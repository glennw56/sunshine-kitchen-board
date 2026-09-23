/** Late-task alert constants. Owner settings can override the stored values. */
export const DEFAULT_OVERDUE_BUFFER_MINUTES = 10;
export const DEFAULT_REALERT_MINUTES = 15;

export const TIME_ZONE = "America/Chicago";

export const DEFAULT_STORE = "Irondale";

/**
 * Square "Test Cook" — lookup only. Never create, update, or delete catalog objects.
 * Stock changes are inventory.batchChange ADJUSTMENT on this variation at Irondale only.
 */
export const SQUARE_TEST_COOK = {
  itemId: "YENSLXSY5HTO74CADKBSQ5CA",
  name: "Test Cook",
  variationId: "HRFLTIDM2ZHZNXN4N4EN6WFQ",
  locationId: "L4CK6YWGT5XQX",
  sku: "C517188",
  /** Inactive homebased location. Never send stock here. */
  forbiddenLocationId: "L6XDJSQS6NY54",
} as const;

export const INVENTORY_TEST_URL =
  "https://sunshine-inventory-test-k6uuoen7wa-ue.a.run.app";

/** Live time clock. Read-only. Override with TIMECLOCK_BASE_URL for the test service. */
export const TIMECLOCK_LIVE_URL =
  "https://sunshine-timeclock-k6uuoen7wa-ue.a.run.app";

export const TIMECLOCK_TEST_URL =
  "https://sunshine-timeclock-test-k6uuoen7wa-ue.a.run.app";

export const KITCHEN_ROLE_PATTERN =
  /cook|kitchen|baker|bake|pastry|prep|pantry|dish/i;
export const FOH_ROLE_PATTERN =
  /foh|front|cashier|server|counter|barista|register|host/i;

export const COOKED_CATEGORY_PATTERN = /cook|finish|baked|bakery goods/i;

export const DEPLOY_SERVICE = "sunshine-kitchen-board-test";
export const DEPLOY_PROJECT = "bakery-444323";
export const DEPLOY_REGION = "us-east1";
export const DEPLOY_BUCKET = "bakery-444323-sunshine-kitchen-board-test";
