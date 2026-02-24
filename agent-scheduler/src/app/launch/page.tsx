"use client";

import { useEffect, useState } from "react";
import FHIR from "fhirclient";

export default function LaunchPage() {
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const url = new URL(window.location.href);
        const iss = url.searchParams.get("iss") || process.env.NEXT_PUBLIC_EPIC_FHIR_URL || "";
        const launch = url.searchParams.get("launch") || undefined;

        const scope = launch
            ? "launch openid fhirUser patient/Patient.read user/Practitioner.read patient/Condition.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Encounter.read patient/Observation.read"
            : "openid fhirUser launch/patient patient/Patient.read user/Practitioner.read patient/Condition.read patient/MedicationRequest.read patient/AllergyIntolerance.read patient/Encounter.read patient/Observation.read";

        FHIR.oauth2
            .authorize({
                iss,
                launch,
                clientId: process.env.NEXT_PUBLIC_EPIC_CLIENT_ID || "",
                scope,
                redirectUri: window.location.origin + "/callback",
                completeInTarget: true,
            })
            .catch((err) => {
                console.error("SMART authorize error:", err);
                setError(err?.message || "Failed to start authorization");
            });
    }, []);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-red-950 to-slate-900">
                <div className="bg-white/5 backdrop-blur-xl border border-red-500/20 rounded-2xl p-8 max-w-md text-center">
                    <h2 className="text-xl font-semibold text-white mb-2">Launch Failed</h2>
                    <p className="text-red-300/70 text-sm mb-4">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
            <div className="text-center">
                <div className="relative w-16 h-16 mx-auto mb-6">
                    <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                    <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-400 animate-spin" />
                </div>
                <h1 className="text-2xl font-semibold text-white mb-2">Connecting to Epic</h1>
                <p className="text-blue-300/70 text-sm">Redirecting to authenticate…</p>
            </div>
        </div>
    );
}
