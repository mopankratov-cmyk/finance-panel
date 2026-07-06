import type { Metadata } from "next";
import { PrivacyPolicyContent } from "./PrivacyPolicyContent";

export const metadata: Metadata = {
  title: "Privacy Policy — NORVIA Publication Cockpit",
  description: "Privacy Policy for the NORVIA Inferno Publication Cockpit and related content publishing workflows.",
};

export default function PrivacyPage() {
  return <PrivacyPolicyContent companyName="NORVIA" />;
}
