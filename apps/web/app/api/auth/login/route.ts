import { NextResponse } from "next/server";
import { authenticateUser } from "@business-os/core";
import { setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 },
      );
    }

    const result = await authenticateUser(email, password);

    if (!result.primaryToken) {
      return NextResponse.json(
        {
          error:
            "No active organization membership found for this user. Contact your workspace administrator.",
        },
        { status: 403 },
      );
    }

    await setSessionCookie(result.primaryToken);

    return NextResponse.json({
      success: true,
      user: result.user,
      organizations: result.organizations,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
