"use client";

import { FhirProvider } from "@/lib/fhir-context";

export function Providers({ children }: { children: React.ReactNode }) {
    return <FhirProvider>{children}</FhirProvider>;
}
