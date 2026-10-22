import { redirect } from "next/navigation";

/** Old address — personal preferences are sections of /settings now. */
export default function PreferencesRedirect() {
  redirect("/settings/notifications");
}
