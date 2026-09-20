import { NextResponse } from "next/server";
import { z } from "zod";
import { switchOrganization } from "@business-os/core";
import { getSessionUser, setSessionCookie } from "@/lib/auth";

const switchOrgSchema = z.object({
  targetOrganizationId: z
    .string()
    .uuid("Target organization ID must be a valid UUID"),
});

export async function POST(request: Request) {
  try {
    const session = await getSessionUser();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const parsed = switchOrgSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const newToken = await switchOrganization({
      userId: session.id,
      targetOrganizationId: parsed.data.targetOrganizationId,
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
