import { ModePage } from "@/components/mode-page";
import { getMode } from "@/lib/content";

export default function PlanTogetherPage() {
  return <ModePage mode={getMode("plan-together")} />;
}
