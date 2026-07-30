export type ModeId =
  | "quiet-budget"
  | "fair-split"
  | "private-circle"
  | "plan-together";

export type Mode = {
  id: ModeId;
  name: string;
  createName: string;
  href: string;
  eyebrow: string;
  summary: string;
  purpose: string;
  privacy: string;
  actionLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  accent: "teal" | "blue" | "amber" | "ink";
};

export const modes: Mode[] = [
  {
    id: "quiet-budget",
    name: "QuietBudget",
    createName: "Private Budget",
    href: "/quiet-budget",
    eyebrow: "Private affordability",
    summary:
      "Find the plans your group can comfortably afford without exposing individual budgets.",
    purpose:
      "Use QuietBudget when a group needs to choose a plan, price point, or trip option without pressuring anyone to reveal what they can spend.",
    privacy:
      "Individual budgets stay private. The group sees only whether a plan works.",
    actionLabel: "Create private budget",
    emptyTitle: "No private budgets yet",
    emptyDescription:
      "Create a QuietBudget room to collect private capacity submissions and publish group-level affordability results.",
    accent: "teal",
  },
  {
    id: "fair-split",
    name: "FairSplit",
    createName: "Fair Split",
    href: "/fair-split",
    eyebrow: "Private-aware shares",
    summary:
      "Split an expense equally or by private capacity, with each person seeing only their own share.",
    purpose:
      "Use FairSplit when a shared cost should be divided clearly while respecting that not everyone has the same financial room.",
    privacy:
      "Each participant sees their own share. Private capacity inputs are not shown to the group.",
    actionLabel: "Create fair split",
    emptyTitle: "No splits yet",
    emptyDescription:
      "Create a split when you are ready to add an expense and choose how shares should be calculated.",
    accent: "blue",
  },
  {
    id: "private-circle",
    name: "Private Circle",
    createName: "Private Collection",
    href: "/private-circle",
    eyebrow: "Confidential collections",
    summary:
      "Collect toward a shared goal while keeping individual contribution amounts confidential.",
    purpose:
      "Use Private Circle for gifts, support pools, community funds, or shared goals where progress matters but individual amounts should stay private.",
    privacy:
      "The group can see overall progress. Individual contribution amounts stay private.",
    actionLabel: "Create collection",
    emptyTitle: "No collections yet",
    emptyDescription:
      "Open a private collection once your group has a goal and is ready to invite contributors.",
    accent: "amber",
  },
  {
    id: "plan-together",
    name: "Plan Together",
    createName: "Complete Group Plan",
    href: "/plan-together",
    eyebrow: "End-to-end planning",
    summary:
      "Move from private affordability checks to fair shares and a confidential collection.",
    purpose:
      "Use Plan Together when your group needs one guided flow from choosing what works to collecting for the final plan.",
    privacy:
      "Private inputs remain private throughout budget checks, split calculation, and collection.",
    actionLabel: "Create group plan",
    emptyTitle: "No group plans yet",
    emptyDescription:
      "Create a guided plan when you want one flow for budgeting, splitting, and collecting.",
    accent: "ink",
  },
];

export const primaryNavItems = [
  { label: "Home", href: "/" },
  { label: "Workspace", href: "/app" },
  { label: "Create", href: "/create" },
  ...modes.map((mode) => ({ label: mode.name, href: mode.href })),
];

export function getMode(id: ModeId) {
  const mode = modes.find((item) => item.id === id);

  if (!mode) {
    throw new Error(`Unknown mode: ${id}`);
  }

  return mode;
}
