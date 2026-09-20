import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function RootPage() {
  const session = await getSessionUser();
  if (!session) {
    redirect("/login");
  }
  redirect("/app");
}
