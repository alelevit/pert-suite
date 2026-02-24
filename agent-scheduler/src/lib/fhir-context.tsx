"use client";

import React, { createContext, useContext, useState, useCallback } from "react";
import Client from "fhirclient/lib/Client";

interface FhirContextType {
    client: Client | null;
    setClient: (client: Client) => void;
    patient: fhir4.Patient | null;
    setPatient: (patient: fhir4.Patient | null) => void;
    practitioner: fhir4.Practitioner | null;
    setPractitioner: (practitioner: fhir4.Practitioner | null) => void;
    isReady: boolean;
}

const FhirContext = createContext<FhirContextType | undefined>(undefined);

export function FhirProvider({ children }: { children: React.ReactNode }) {
    const [client, setClientState] = useState<Client | null>(null);
    const [patient, setPatient] = useState<fhir4.Patient | null>(null);
    const [practitioner, setPractitioner] =
        useState<fhir4.Practitioner | null>(null);

    const setClient = useCallback((c: Client) => {
        setClientState(c);
    }, []);

    return (
        <FhirContext.Provider
            value={{
                client,
                setClient,
                patient,
                setPatient,
                practitioner,
                setPractitioner,
                isReady: client !== null,
            }}
        >
            {children}
        </FhirContext.Provider>
    );
}

export function useFhir() {
    const ctx = useContext(FhirContext);
    if (!ctx) throw new Error("useFhir must be used within a FhirProvider");
    return ctx;
}
