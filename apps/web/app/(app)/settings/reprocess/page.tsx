import { redirect } from "next/navigation";

/** Old address — reprocessing is part of Settings → General now. */
export default function ReprocessRedirect() {
  redirect("/settings/general");
}
