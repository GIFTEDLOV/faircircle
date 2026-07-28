import { ModePage } from "@/components/mode-page";
import { getMode } from "@/lib/content";

export default function PrivateCirclePage() {
  return <ModePage mode={getMode("private-circle")} />;
}
