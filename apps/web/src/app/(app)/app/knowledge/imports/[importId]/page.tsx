"use client";

import { useParams } from "next/navigation";
import { BusinessImportPage } from "@/design/product/knowledge/imports/BusinessImportPage";

export default function Page() {
  const params = useParams<{ importId: string }>();
  return <BusinessImportPage importId={params.importId ?? ""} />;
}
