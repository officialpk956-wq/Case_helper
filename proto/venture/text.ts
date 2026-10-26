// PROTOTYPE. The words that go with the two product-manager cases: what each item is, what each hidden fact means, who says what.
// Shared by docgen.ts and export.ts. The scenario files in scenarios/ are the source of truth now; this is where their text was written.

export const ABOUT: Record<string, string> = {
  kyc_camera: "Guided capture for the identity photo: framing hints, glare warnings, one automatic retry.",
  kyc_defer: "Let people make a first payment before verification finishes, with a low limit until it does.",
  first_reward: "A small cashback on the first successful payment.",
  lang_onboard: "Onboarding and error messages in six regional languages.",
  support_bot: "An assistant that answers the twenty commonest support questions without a person.",
  salary_link: "Link a salary account and offer credit against it. Needs the partner bank's confidence.",
  soundbox: "Integrate a QR speaker so merchants hear each payment. Marigold subsidises the device, about ₹1,800 for each of its 46,000 merchants. The chief executive's favourite.",
  fraud_v2: "A rules engine that scores each payment before it clears. Needed before verification can be deferred safely.",
  app_perf: "Make the app fast on 2 GB phones: smaller bundles, fewer cold starts.",
  nudges: "Timely reminders to finish verification and to make a first payment.",
  referral: "Pay a user and their friend when the friend makes a first payment.",
  analytics_v2: "Record every step of the funnel as events, so the team can see where people leave. Raises measurement to level 2.",
  core_refactor: "Rebuild the identity service that every release has to work around. Pays down technical debt.",
  onboarding_wizard: "Guided set-up: import clients, invite a teammate, log a first timesheet.",
  tiering: "Replace the single plan with three tiers: Good, Better, Best.",
  usage_addon: "A metered add-on for the heaviest users (projects, exports, storage).",
  annual_plan: "A discount for paying annually, in the app and at renewal.",
  sso_audit: "Single sign-on and an audit log, which security reviews at large agencies demand. The sales head's favourite.",
  billing_rewrite: "Rewrite the billing module (proration, taxes, invoices) behind every outage this year. Pays down technical debt.",
  integrations: "Sync with the three accounting tools agencies use.",
  mobile_time: "A mobile timesheet for people who bill by the hour.",
  reporting: "Profitability dashboards: margin by client, by project, by person.",
  design_system: "Roll out one component library across the app.",
  perf_reliability: "A sprint on speed and uptime.",
  upgrade_flow: "In-app prompts and a one-page upgrade flow at the moments people hit a limit.",
};

export const HIDDEN: Record<string, string> = {
  camera_share: "Of the people who fail identity verification, the share who fail at the camera step rather than at document rules or mismatches. Support says most of it is the camera.",
  fraud_mult: "Fraud losses, as a multiple of today's, if people can pay before verification finishes. The risk team's number was made when the plan was a small pilot.",
  reward_hunters: "The share of people who take the first-payment reward and leave once it is spent. Growth's figure comes from a campaign that targeted loyal users.",
  merchant_pull: "How much merchants really value the soundbox, as a share of the benefit the chief executive expects. Taken from three merchants they met.",
  elasticity: "How hard paid conversion falls when the plans are repackaged. Sales says customers will not mind.",
  addon_wtp: "What customers will pay for a usage add-on, relative to what customer success heard in renewal calls.",
  billing_share: "The share of customer losses that billing errors cause. Finance counts only tickets filed as billing complaints.",
  ent_pipeline: "The share of the enterprise upside that single sign-on would really unlock; other things also stall large deals. Sales counts every lost deal that mentioned security.",
};

export const HIDDEN_LABEL: Record<string, { label: string; unit: "share" | "multiple" }> = {
  camera_share: { label: "Share of verification failures that are the camera step", unit: "share" },
  fraud_mult: { label: "Fraud losses if verification is deferred, against today's", unit: "multiple" },
  reward_hunters: { label: "Share of rewarded users who leave once the reward is spent", unit: "share" },
  merchant_pull: { label: "How much merchants value the soundbox, against what is expected", unit: "share" },
  elasticity: { label: "How hard paid conversion falls when plans are repackaged", unit: "multiple" },
  addon_wtp: { label: "What customers will pay for a usage add-on, against what was heard", unit: "multiple" },
  billing_share: { label: "Share of customer losses caused by billing errors", unit: "share" },
  ent_pipeline: { label: "Share of the enterprise upside that single sign-on really unlocks", unit: "share" },
};
