const RETIRED_WB_ROUTES = {
  "/wb/abc": "/wb/rnp",
  "/abc": "/wb/rnp",
  "/wb/trends": "/wb/market",
  "/trends": "/wb/market",
  "/wb/planning": "/wb/rnp",
  "/planning": "/wb/rnp",
  "/wb/health": "/wb/rnp",
  "/wb/tasks": "/wb/rnp",
} as const;

export type RetiredWbRoute = keyof typeof RETIRED_WB_ROUTES;

export function wbRetiredRouteDestination(route: RetiredWbRoute) {
  return RETIRED_WB_ROUTES[route];
}
