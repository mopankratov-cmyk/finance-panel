const UPDATED_AT = "2026-07-06";

const sections = [
  {
    title: "1. Who We Are",
    body: [
      "Inferno Publication Cockpit is a content operations surface used to prepare, schedule, publish, and analyze media content across supported distribution channels.",
      "This page applies to the public deployment used for product demonstrations, channel integrations, and partner platform reviews, including Pinterest application review for NORVIA.",
    ],
  },
  {
    title: "2. What Data We Process",
    body: [
      "We may process operational account metadata, publication targets, generated media links, analytics snapshots, and support messages required to run content publishing workflows.",
      "When Telegram-based operational flows are enabled, the system may process bot chat identifiers, message metadata, and explicit operator review inputs needed to complete publishing and quality-control actions.",
    ],
  },
  {
    title: "3. Why We Process Data",
    body: [
      "We process data strictly to operate the publication workflow: deliver content to selected channels, monitor publication results, evaluate performance, and improve future content iterations.",
      "We do not describe this surface as a consumer social product. It is an internal or partner-operated publishing cockpit for controlled content workflows.",
    ],
  },
  {
    title: "4. Pinterest And Other Platform Integrations",
    body: [
      "If Pinterest access is enabled, the application may use Pinterest APIs to publish approved content, retrieve board information, and read analytics associated with authorized business content.",
      "Platform data is used only for the publishing task, troubleshooting, and performance analysis inside the cockpit.",
    ],
  },
  {
    title: "5. Data Sharing",
    body: [
      "We share data only with infrastructure and platform providers required to run the workflow, such as hosting, storage, database, and officially supported channel APIs.",
      "We do not sell personal data or share operational data for unrelated advertising purposes from this cockpit.",
    ],
  },
  {
    title: "6. Data Retention",
    body: [
      "Operational records may be retained for service continuity, debugging, publication history, and analytics comparisons for as long as they remain relevant to active workflows.",
      "We may remove obsolete records, test artifacts, or inactive integration data when they are no longer needed for operations or compliance.",
    ],
  },
  {
    title: "7. Security",
    body: [
      "We use reasonable technical and organizational measures to protect access credentials, integration tokens, and operational data used by the cockpit.",
      "Sensitive secrets are intended to be stored in environment configuration and not exposed in public client code.",
    ],
  },
  {
    title: "8. Your Choices",
    body: [
      "If you are an integration partner, operator, or reviewer and need clarification about what data is being processed for a given workflow, you can request details through the project contact listed below.",
      "Where technically feasible, access to a channel integration can be disabled by removing the relevant credentials or unbinding the related account configuration.",
    ],
  },
  {
    title: "9. Contact",
    body: [
      "For privacy or integration review questions related to this deployment, contact the project operator through the published business contact used for the associated application review.",
      "If a dedicated contact mailbox is added later, this page should be updated to reflect that canonical address.",
    ],
  },
];

export function PrivacyPolicyContent({ companyName }: { companyName: string }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0B0D10",
        color: "#EDEFEA",
        fontFamily: 'var(--font-geist-sans), Inter, system-ui, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: 980,
          margin: "0 auto",
          padding: "56px 24px 88px",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderRadius: 999,
            border: "1px solid #262C35",
            background: "#12161B",
            color: "#BEF34A",
            fontSize: 12,
            letterSpacing: ".12em",
            textTransform: "uppercase",
          }}
        >
          {companyName}
          <span style={{ color: "#838B96" }}>Publication Cockpit</span>
        </div>

        <header style={{ marginTop: 22, marginBottom: 28 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 46,
              lineHeight: 1,
              fontWeight: 700,
              letterSpacing: "-0.03em",
            }}
          >
            Privacy Policy
          </h1>
          <p
            style={{
              marginTop: 14,
              maxWidth: 760,
              color: "#A6ADB6",
              fontSize: 18,
              lineHeight: 1.55,
            }}
          >
            This privacy page is published for the standalone Inferno Publication Cockpit deployment
            used for content publishing operations, analytics review, and channel integration approval
            for {companyName}.
          </p>
          <div
            style={{
              marginTop: 18,
              color: "#838B96",
              fontSize: 13,
              letterSpacing: ".08em",
              textTransform: "uppercase",
            }}
          >
            Last updated: {UPDATED_AT}
          </div>
        </header>

        <section
          style={{
            display: "grid",
            gap: 16,
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            marginBottom: 20,
          }}
        >
          <PolicyStat title="Company" value={companyName} />
          <PolicyStat title="Integrations" value="Pinterest · Telegram" />
          <PolicyStat title="Surface" value="Standalone public domain" />
        </section>

        <div
          style={{
            padding: 18,
            borderRadius: 18,
            border: "1px solid rgba(190,243,74,.16)",
            background: "rgba(190,243,74,.07)",
            color: "#DCE8B8",
            marginBottom: 24,
            lineHeight: 1.6,
          }}
        >
          This page exists as a publicly reachable privacy policy for platform review and channel
          integration compliance. It is intended to be accessible without authentication on the same
          production domain as the cockpit deployment.
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {sections.map((section) => (
            <section
              key={section.title}
              style={{
                padding: "22px 22px 20px",
                borderRadius: 22,
                border: "1px solid #20252D",
                background: "#12161B",
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontSize: 24,
                  lineHeight: 1.15,
                  fontWeight: 650,
                }}
              >
                {section.title}
              </h2>
              <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
                {section.body.map((paragraph) => (
                  <p
                    key={paragraph}
                    style={{
                      margin: 0,
                      color: "#B7BDC6",
                      fontSize: 16,
                      lineHeight: 1.7,
                    }}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}

function PolicyStat({ title, value }: { title: string; value: string }) {
  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 18,
        border: "1px solid #20252D",
        background: "#12161B",
      }}
    >
      <div
        style={{
          color: "#838B96",
          fontSize: 11,
          letterSpacing: ".12em",
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div
        style={{
          marginTop: 10,
          color: "#F2F4EF",
          fontSize: 20,
          lineHeight: 1.2,
          fontWeight: 600,
        }}
      >
        {value}
      </div>
    </div>
  );
}
