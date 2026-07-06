import type { Session } from "./session";

export const DEMO_MODE_ENABLED = process.env.PUBLIC_DEMO_MODE === "1";

export const DEMO_SESSION: Session = {
  uid: "public-demo",
  email: "demo@finance-panel.local",
  role: "director",
  cabinet_ids: [],
};
