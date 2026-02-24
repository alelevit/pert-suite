"use client";

import { useEffect, useState } from "react";
import FHIR from "fhirclient";

/**
 * This page handles BOTH the initial launch AND the OAuth callback.
 */
export default function CallbackPage() {
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState("Initializing…");

    useEffect(() => {
        const url = new URL(window.location.href);
        const iss = url.searchParams.get("iss");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");

        if (errorParam) {
            setError(errorDesc || errorParam);
            return;
        }

        if (iss && !code && !state) {
            setStatus("Connecting to Epic…");
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
        } else if (code || state) {
            setStatus("Completing sign-in…");

            FHIR.oauth2
                .ready()
                .then(async () => {
                    window.location.href = "/dashboard";
                })
                .catch((err) => {
                    console.error("SMART ready error:", err);
                    setError(err?.message || "Authentication failed");
                });
        } else {
            setError(
                "Missing parameters. Please launch this app from the Epic LaunchPad or use /launch."
            );
        }
    }, []);

    if (error) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-red-950 to-slate-900">
                <div className="bg-white/5 backdrop-blur-xl border border-red-500/20 rounded-2xl p-8 max-w-md text-center">
                    <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                        <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold text-white mb-2">Authentication Failed</h2>
                    <p className="text-red-300/70 text-sm mb-6">{error}</p>
                    <a href="/launch" className="inline-block px-6 py-2.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 rounded-lg transition-colors text-sm font-medium">
                        Try Again
                    </a>
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
                <h1 className="text-2xl font-semibold text-white mb-2">{status}</h1>
                <p className="text-blue-300/70 text-sm">Authenticating with your EHR system…</p>
            </div>
        </div>
    );
}
