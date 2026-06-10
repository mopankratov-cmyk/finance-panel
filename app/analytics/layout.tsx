import { AnalyticsDataProvider } from "@/components/analytics/AnalyticsDataProvider";

export default function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AnalyticsDataProvider>{children}</AnalyticsDataProvider>;
}
