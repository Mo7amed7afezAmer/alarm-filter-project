import { redirect } from "next/navigation";

/** Old address — the office view is part of Settings → General now. */
export default function OfficeRedirect() {
  redirect("/settings/general");
}
