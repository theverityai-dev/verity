import { NextResponse, type NextRequest } from "next/server";
import { runtimeConfig } from "@/server/platform/config";
import { discoverProviderMetadata } from "@/server/platform/oidc";
import { publicUrl } from "@/server/platform/public-url";
import {
  OIDC_SESSION_COOKIE,
  OIDC_TRANSACTION_COOKIE,
} from "@/server/platform/oidc-browser";
import { captureError } from "@/server/platform/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const settings = runtimeConfig.auth.oidc;
  const signIn = publicUrl("/sign-in");
  let destination = signIn;
  if (runtimeConfig.auth.provider === "oidc" && settings) {
    try {
      const metadata = await discoverProviderMetadata(settings.issuer);
      if (metadata.endSessionEndpoint) {
        destination = new URL(metadata.endSessionEndpoint);
        destination.searchParams.set("client_id", settings.clientId);
        destination.searchParams.set("post_logout_redirect_uri", signIn.toString());
      }
    } catch (error) {
      captureError(error, { route: "oidc_logout" });
    }
  }

  const response = NextResponse.redirect(destination);
  response.cookies.delete(OIDC_SESSION_COOKIE);
  response.cookies.delete(OIDC_TRANSACTION_COOKIE);
  response.cookies.delete("verity_active_membership");
  response.headers.set("cache-control", "no-store");
  return response;
}

