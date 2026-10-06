import { redirect } from "next/navigation";

/** Moved to the general data import page. */
export default function ResidentsImportRedirect() {
  redirect("/import?type=residents");
}
