import { NextResponse } from "next/server";
import { authenticateUser, consumeRateLimit } from "@business-os/core";
import { logger } from "@business-os/logger";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  let clientIp = "127.0.0.1";
  let normalizedEmail = "";

  try {
    // 1. Resolve client IP from reverse proxy headers.
    // SECURITY NOTE: In production deployment, reverse proxies (e.g., Cloudflare, AWS ALB, Nginx)
    // MUST be configured to overwrite or sanitize X-Forwarded-For to prevent spoofed IP bypasses.
    const forwardedFor = request.headers.get("x-forwarded-for");
    const realIp = request.headers.get("x-real-ip");
    if (forwardedFor) {
      clientIp = forwardedFor.split(",")[0].trim();
    } else if (realIp) {
      clientIp = realIp.trim();
    }

    const body = await request.json();
    const { email, password } = body;

    if (
      !email ||
      typeof email !== "string" ||
      !password ||
      typeof password !== "string"
    ) {
      return NextResponse.json(
        { error: "Unable to sign in with these credentials." },
        { status: 401 },
      );
    }

    normalizedEmail = email.trim().toLowerCase();

    // 2. Sliding-window rate limit protection against brute-force attacks (5 attempts per minute)
    const rateLimitKey = `auth:login:${clientIp}:${normalizedEmail}`;
    const rateLimitResult = await consumeRateLimit(rateLimitKey, {
      maxRequests: 5,
      windowMs: 60000,
      keyPrefix: "login_limit",
    });

    if (!rateLimitResult.allowed) {
      logger.warn(
        { clientIp, email: normalizedEmail },
        "Login rate limit exceeded",
      );
      return NextResponse.json(
        { error: "Too many login attempts. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": "60",
            "X-RateLimit-Limit": "5",
            "X-RateLimit-Remaining": "0",
          },
        },
      );
    }

    // 3. Attempt Authentication
    const result = await authenticateUser(normalizedEmail, password);

    // If user has no active organization membership, do NOT disclose internal membership status
    if (!result.primaryToken) {
      logger.warn(
        { userId: result.user.id, email: normalizedEmail },
        "Login succeeded for user but no active tenant organization membership found",
      );
      return NextResponse.json(
        { error: "Unable to sign in with these credentials." },
        { status: 401 },
      );
    }

    await setSessionCookie(result.primaryToken);

    logger.info(
      { userId: result.user.id, email: normalizedEmail },
      "User authenticated successfully",
    );

    return NextResponse.json({
      success: true,
      user: result.user,
      organizations: result.organizations,
    });
  } catch (err: unknown) {
    // Prevent account state enumeration: log exact reason internally, return uniform generic error to client
    logger.warn(
      {
        clientIp,
        email: normalizedEmail,
        error: err instanceof Error ? err.message : String(err),
      },
      "Authentication failed for user",
    );

    return NextResponse.json(
      { error: "Unable to sign in with these credentials." },
      { status: 401 },
    );
  }
}
