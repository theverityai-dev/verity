import { redirect } from "next/navigation";

/** The CRM opens on the pipeline. */
export default function CrmPage() {
  redirect("/crm/opportunities");
}
