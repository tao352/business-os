import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@business-os/database";

export async function GET() {
  const dbOk = await checkDatabaseHealth();
  if (!dbOk) {
    return NextResponse.json(
      { status: "unhealthy", database: "down" },
      { status: 503 },
    );
  }

  return NextResponse.json({ status: "healthy", database: "connected" });
}
