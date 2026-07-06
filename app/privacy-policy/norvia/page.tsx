import type { Metadata } from "next";
import { PrivacyPolicyContent } from "../../privacy/PrivacyPolicyContent";

export const metadata: Metadata = {
  title: "NORVIA Privacy Policy",
  description: "Public privacy policy for NORVIA on the Inferno Publication Cockpit deployment.",
};

export default function NorviaNamedPrivacyPolicyPage() {
  return <PrivacyPolicyContent companyName="NORVIA" />;
}
