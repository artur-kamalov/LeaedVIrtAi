"use client";

import { DemoDashboardPage } from "@/design/demo/DemoDashboardPage";
import { ProductModeProvider } from "@/design/product/ProductMode";

export default function Page() {
  return (
    <ProductModeProvider mode="demo">
      <DemoDashboardPage />
    </ProductModeProvider>
  );
}
