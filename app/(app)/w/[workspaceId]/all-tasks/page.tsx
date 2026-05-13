import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

// Workspace "My tasks" view retired 2026-05-13: replaced by the personal
// `/me` cross-workspace dashboard. Old bookmarks bounce there so we don't
// break links.
export default async function AllTasksRedirect() {
  await requireUser();
  redirect("/me");
}
