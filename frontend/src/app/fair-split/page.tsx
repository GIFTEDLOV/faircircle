import { ModePage } from "@/components/mode-page";
import { getMode } from "@/lib/content";

export default function FairSplitPage() {
  return <ModePage mode={getMode("fair-split")} />;
}
