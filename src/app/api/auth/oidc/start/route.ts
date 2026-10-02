import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/server/platform/db";
import { runtimeConfig } from "@/server/platform/config";
import { publicUrl } from "@/server/platform/public-url";
import {
  OIDC_TRANSACTION_COOKIE,
  createOidcAuthorization,
  oidcStateHash,
} from "@/server/platform/oidc-browser";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (runtimeConfig.auth.provider !== "oidc" || !runtimeConfig.auth.oidc) {
    return NextResponse.redirect(publicUrl("/sign-in"));
  }

  const authorization = await createOidcAuthorization(
    runtimeConfig.auth.oidc,
    runtimeConfig.auth.jwtSecret,
    request.nextUrl.searchParams.get("returnTo"),
  );
  const now = new Date();
  await prisma.$transaction([
    prisma.oidcLoginTransaction.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.oidcLoginTransaction.create({
      data: {
        stateHash: oidcStateHash(authorization.transaction.state),
        expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
      },
    }),
  ]);

  const response = NextResponse.redirect(authorization.url);
  response.cookies.set(OIDC_TRANSACTION_COOKIE, authorization.transactionCookie, {
    httpOnly: true,
    secure: runtimeConfig.nodeEnv === "production",
    sameSite: "lax",
    path: "/api/auth/oidc",
    maxAge: 10 * 60,
    priority: "high",
  });
  response.headers.set("cache-control", "no-store");
  return response;
}

