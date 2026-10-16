"use client";

import { Button } from "@/components/ui/primitives";

export function PrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      Print nameplate
    </Button>
  );
}
