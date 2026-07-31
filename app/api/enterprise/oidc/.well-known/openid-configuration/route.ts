import { NextResponse } from "next/server.js";

import { oidcDiscovery, oidcProviderConfig } from "../../../../../../lib/enterprise-platform/oidc-provider.ts";
import {
  OIDC_PUBLIC_METADATA_HEADERS,
  oidcErrorResponse,
} from "../../../../../../lib/enterprise-platform/oidc-provider-route.ts";

export async function GET() {
  try {
    return NextResponse.json(oidcDiscovery(oidcProviderConfig()), {
      headers: OIDC_PUBLIC_METADATA_HEADERS,
    });
  } catch (error) {
    return oidcErrorResponse(error);
  }
}
