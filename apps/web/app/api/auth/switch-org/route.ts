import { NextResponse } from "next/server";
import { switchOrganization } from "@business-os/core";
import { getSessionUser, setSessionCookie } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { targetOrganizationId } = await request.json();
    if (!targetOrganizationId) {
      return NextResponse.json(
        { error: "Target organization ID is required" },
        { status: 400 },
      );
    }

    const newToken = await switchOrganization({
      userId: session.id,
      targetOrganizationId,
      email: session.email,
    });

    await setSessionCookie(newToken);

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Failed to switch organization";
    return NextResponse.json({ error: message }, { status: 403 });
  }
}
