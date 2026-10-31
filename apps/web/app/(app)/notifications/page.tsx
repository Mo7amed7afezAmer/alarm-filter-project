import { redirect } from "next/navigation";

/** Old address — notifications are a section of /settings now. */
export default function NotificationsRedirect() {
  redirect("/settings/notifications");
}
