const RETIRED_WB_ROUTES = {
  "/wb/abc": "/wb",
  "/abc": "/wb",
  "/wb/trends": "/wb/market",
  "/trends": "/wb/market",
  "/wb/planning": "/wb",
  "/planning": "/wb",
  "/wb/health": "/wb",
  "/wb/tasks": "/wb",
} as const;

export type RetiredWbRoute = keyof typeof RETIRED_WB_ROUTES;

export function wbRetiredRouteDestination(route: RetiredWbRoute) {
  return RETIRED_WB_ROUTES[route];
}
