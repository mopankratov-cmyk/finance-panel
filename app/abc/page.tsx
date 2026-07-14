import { redirect } from "next/navigation";
import { wbRetiredRouteDestination } from "@/lib/wb/retiredRoutes";

export default function Page() {
  redirect(wbRetiredRouteDestination("/abc"));
}
