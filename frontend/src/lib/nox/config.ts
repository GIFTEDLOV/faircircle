import { fairCircleDeployment } from "@/generated/contracts";
import { MissingPublicConfigError } from "@/lib/web3/errors";

type BrowserHttpUrl = `http://${string}` | `https://${string}`;

export function getNoxBrowserConfig() {
  const gatewayUrl = process.env.NEXT_PUBLIC_NOX_HANDLE_GATEWAY_URL?.trim();
  const subgraphUrl = process.env.NEXT_PUBLIC_NOX_SUBGRAPH_URL?.trim();
  if (!gatewayUrl) {
    throw new MissingPublicConfigError("NEXT_PUBLIC_NOX_HANDLE_GATEWAY_URL");
  }
  if (!subgraphUrl) {
    throw new MissingPublicConfigError("NEXT_PUBLIC_NOX_SUBGRAPH_URL");
  }
  assertHttpUrl(gatewayUrl, "NEXT_PUBLIC_NOX_HANDLE_GATEWAY_URL");
  assertHttpUrl(subgraphUrl, "NEXT_PUBLIC_NOX_SUBGRAPH_URL");
  return {
    smartContractAddress: fairCircleDeployment.nox.address,
    gatewayUrl,
    subgraphUrl,
  };
}

function assertHttpUrl(value: string, name: string): asserts value is BrowserHttpUrl {
  if (!value.startsWith("https://") && !value.startsWith("http://")) {
    throw new MissingPublicConfigError(name);
  }
}
