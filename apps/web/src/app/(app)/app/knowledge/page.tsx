"use client";

import { Suspense } from "react";
import { KnowledgePage } from "@/design/product/knowledge/KnowledgePage";
import { LoadingOverlay } from "@/design/product/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingOverlay label="Loading Knowledge..." />}>
      <KnowledgePage />
    </Suspense>
  );
}
