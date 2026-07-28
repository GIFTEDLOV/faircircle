import { ModePage } from "@/components/mode-page";
import { getMode } from "@/lib/content";

export default function QuietBudgetPage() {
  return <ModePage mode={getMode("quiet-budget")} />;
}
