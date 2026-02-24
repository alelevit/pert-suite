"use client";

import { useState, useEffect, useCallback } from "react";
import FHIR from "fhirclient";
import Client from "fhirclient/lib/Client";
import { findOnCallProvider, OnCallResult } from "@/lib/actions";
import { documentConsultCall, AuditEntry } from "@/lib/fhir-writeback";

/* ---------- helpers ---------- */
function formatName(name?: fhir4.HumanName[]): string {
    if (!name || name.length === 0) return "Unknown";
    const n = name[0];
    const parts: string[] = [];
    if (n.prefix) parts.push(...n.prefix);
    if (n.given) parts.push(...n.given);
    if (n.family) parts.push(n.family);
    return parts.join(" ") || n.text || "Unknown";
}

function formatDate(d?: string): string {
    if (!d) return "N/A";
    return new Date(d + "T00:00:00").toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

function shortDate(d?: string): string {
    if (!d) return "";
    return new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    });
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type FhirBundle = { entry?: { resource: any }[];[k: string]: any };

function bundleResources(bundle: FhirBundle): any[] {
    return bundle?.entry?.map((e: any) => e.resource) ?? [];
}

/* ---------- types for clinical data ---------- */
interface ClinicalData {
    conditions: any[];
    medications: any[];
    allergies: any[];
    encounters: any[];
    observations: any[];
}

/* ---------- component ---------- */
export default function DashboardPage() {
    const [client, setClient] = useState<Client | null>(null);
    const [patient, setPatient] = useState<fhir4.Patient | null>(null);
    const [practitioner, setPractitioner] = useState<fhir4.Practitioner | null>(null);
    const [clinical, setClinical] = useState<ClinicalData>({
        conditions: [],
        medications: [],
        allergies: [],
        encounters: [],
        observations: [],
    });
    const [loading, setLoading] = useState(true);
    const [clinicalLoading, setClinicalLoading] = useState(false);
    const [selectedSpecialty, setSelectedSpecialty] = useState("Cardiology");
    const [result, setResult] = useState<OnCallResult | null>(null);
    const [searching, setSearching] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [fetchErrors, setFetchErrors] = useState<string[]>([]);
    const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
    const [documenting, setDocumenting] = useState(false);
    const [showAuditTrail, setShowAuditTrail] = useState(false);

    const isDemoMode = !client;

    /* fetch clinical data once we have a client with patient context */
    const fetchClinicalData = useCallback(async (fhirClient: Client) => {
        setClinicalLoading(true);
        const errors: string[] = [];
        const patientId = fhirClient.patient.id;

        const safeFetch = async (url: string, label: string): Promise<any[]> => {
            try {
                const bundle = await fhirClient.request(url);
                return bundleResources(bundle);
            } catch (e: any) {
                const status = e?.statusCode || e?.status || "";
                errors.push(`${label}: ${status === 403 ? "Not authorized (add API to Epic app)" : e?.message || "Failed"}`);
                return [];
            }
        };

        const [conditions, medications, allergies, encounters, observations] =
            await Promise.all([
                safeFetch(`Condition?patient=${patientId}&category=problem-list-item&_count=20`, "Conditions"),
                safeFetch(`MedicationRequest?patient=${patientId}&status=active&_count=20`, "Medications"),
                safeFetch(`AllergyIntolerance?patient=${patientId}&_count=20`, "Allergies"),
                safeFetch(`Encounter?patient=${patientId}&_count=10&_sort=-date`, "Encounters"),
                safeFetch(`Observation?patient=${patientId}&category=vital-signs&_count=10&_sort=-date`, "Vitals"),
            ]);

        setClinical({ conditions, medications, allergies, encounters, observations });
        setFetchErrors(errors);
        setClinicalLoading(false);
    }, []);

    useEffect(() => {
        FHIR.oauth2
            .ready()
            .then(async (fhirClient) => {
                setClient(fhirClient);

                try {
                    const pt = await fhirClient.patient.read();
                    setPatient(pt as fhir4.Patient);
                } catch (e) {
                    console.warn("Could not read patient context:", e);
                }

                try {
                    const userId = fhirClient.getUserId();
                    if (userId) {
                        const prac = await fhirClient.request(`Practitioner/${userId}`);
                        setPractitioner(prac as fhir4.Practitioner);
                    }
                } catch (e) {
                    console.warn("Could not read practitioner:", e);
                }

                // fetch clinical data
                if (fhirClient.patient.id) {
                    fetchClinicalData(fhirClient);
                }
            })
            .catch(() => {
                console.log("No FHIR session found, running in demo mode");
            })
            .finally(() => setLoading(false));
    }, [fetchClinicalData]);

    /* demo data */
    const patientName = isDemoMode ? "Jason Argonaut" : formatName(patient?.name);
    const patientDOB = isDemoMode ? "August 1, 1925" : formatDate(patient?.birthDate);
    const patientGender = isDemoMode ? "Male" : patient?.gender || "N/A";
    const practitionerName = isDemoMode ? "Dr. Jane Smith" : formatName(practitioner?.name);

    const specialties = ["Cardiology", "Neurology", "Orthopedics", "Pulmonology", "Gastroenterology", "Nephrology"];

    async function handleFindOnCall() {
        setSearching(true);
        try {
            const res = await findOnCallProvider(selectedSpecialty, "Main Campus");
            setResult(res);
            setShowModal(true);
        } finally {
            setSearching(false);
        }
    }

    async function handleDocumentConsult() {
        if (!result || !client || !client.patient.id) return;
        setDocumenting(true);
        setAuditLog([]);
        setShowAuditTrail(true);

        await documentConsultCall(client, {
            patientId: client.patient.id,
            consultantName: result.name,
            specialty: selectedSpecialty,
            organization: result.organization,
            contactMethod: result.contactMethod,
            onAudit: (entry) => {
                setAuditLog((prev) => {
                    // Replace last "pending" entry for the same action, or add new
                    const last = prev[prev.length - 1];
                    if (last && last.status === "pending" && entry.action === last.action) {
                        return [...prev.slice(0, -1), entry];
                    }
                    return [...prev, entry];
                });
            },
        });

        setDocumenting(false);
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900">
                <div className="text-center">
                    <div className="relative w-16 h-16 mx-auto mb-6">
                        <div className="absolute inset-0 rounded-full border-4 border-blue-500/20" />
                        <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-blue-400 animate-spin" />
                    </div>
                    <h1 className="text-2xl font-semibold text-white mb-2">Loading Dashboard</h1>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-indigo-900 text-white">
            {/* ── Header ── */}
            <header className="border-b border-white/5 bg-white/[0.02] backdrop-blur-sm sticky top-0 z-40">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                        </div>
                        <div>
                            <h1 className="text-lg font-semibold tracking-tight">Agent Scheduler</h1>
                            <p className="text-xs text-blue-300/50">SMART on FHIR</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        {isDemoMode ? (
                            <span className="px-2.5 py-1 text-xs font-medium bg-amber-500/15 text-amber-300 rounded-full border border-amber-500/20">Demo Mode</span>
                        ) : (
                            <span className="px-2.5 py-1 text-xs font-medium bg-emerald-500/15 text-emerald-300 rounded-full border border-emerald-500/20 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                Connected to Epic
                            </span>
                        )}
                        <div className="text-right">
                            <p className="text-sm font-medium text-white/80">{practitionerName}</p>
                            <p className="text-xs text-blue-300/50">Provider</p>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                {/* ── Patient Banner ── */}
                <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                    <div className="flex items-center gap-2 mb-4">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50">Patient Context</h2>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                        <div className="md:col-span-1">
                            <p className="text-xs text-blue-300/40 mb-1">Patient Name</p>
                            <p className="text-xl font-bold tracking-tight">{patientName}</p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-300/40 mb-1">Date of Birth</p>
                            <p className="text-lg font-semibold">{patientDOB}</p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-300/40 mb-1">Gender</p>
                            <p className="text-lg font-semibold capitalize">{patientGender}</p>
                        </div>
                        <div>
                            <p className="text-xs text-blue-300/40 mb-1">MRN</p>
                            <p className="text-lg font-semibold font-mono">
                                {isDemoMode
                                    ? "E1234"
                                    : patient?.identifier?.find((i: any) => i.type?.text === "MRN" || i.type?.coding?.[0]?.code === "MR")
                                        ?.value || patient?.id?.slice(0, 12) || "—"}
                            </p>
                        </div>
                    </div>
                </section>

                {/* ── Clinical Data Grid ── */}
                {!isDemoMode && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Conditions */}
                        <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 flex items-center gap-2">
                                    <span className="text-base">🩺</span> Active Problems
                                </h2>
                                <span className="text-xs text-blue-300/30">{clinical.conditions.length} found</span>
                            </div>
                            {clinicalLoading ? (
                                <LoadingPulse />
                            ) : clinical.conditions.length === 0 ? (
                                <EmptyState label="No conditions on file" />
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                                    {clinical.conditions.map((c: any, i: number) => (
                                        <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-colors">
                                            <p className="text-sm font-medium text-white/90">
                                                {c.code?.text || c.code?.coding?.[0]?.display || "Unknown condition"}
                                            </p>
                                            <div className="flex items-center gap-3 mt-1">
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${c.clinicalStatus?.coding?.[0]?.code === "active"
                                                    ? "bg-red-500/15 text-red-300"
                                                    : "bg-slate-500/15 text-slate-400"
                                                    }`}>
                                                    {c.clinicalStatus?.coding?.[0]?.code || "unknown"}
                                                </span>
                                                {c.onsetDateTime && (
                                                    <span className="text-xs text-blue-300/40">onset {shortDate(c.onsetDateTime)}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Medications */}
                        <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 flex items-center gap-2">
                                    <span className="text-base">💊</span> Active Medications
                                </h2>
                                <span className="text-xs text-blue-300/30">{clinical.medications.length} found</span>
                            </div>
                            {clinicalLoading ? (
                                <LoadingPulse />
                            ) : clinical.medications.length === 0 ? (
                                <EmptyState label="No active medications" />
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                                    {clinical.medications.map((m: any, i: number) => (
                                        <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-colors">
                                            <p className="text-sm font-medium text-white/90">
                                                {m.medicationCodeableConcept?.text ||
                                                    m.medicationCodeableConcept?.coding?.[0]?.display ||
                                                    m.medicationReference?.display ||
                                                    "Unknown medication"}
                                            </p>
                                            {m.dosageInstruction?.[0]?.text && (
                                                <p className="text-xs text-blue-300/50 mt-1">{m.dosageInstruction[0].text}</p>
                                            )}
                                            {m.authoredOn && (
                                                <p className="text-xs text-blue-300/30 mt-1">prescribed {shortDate(m.authoredOn)}</p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Allergies */}
                        <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 flex items-center gap-2">
                                    <span className="text-base">⚠️</span> Allergies
                                </h2>
                                <span className="text-xs text-blue-300/30">{clinical.allergies.length} found</span>
                            </div>
                            {clinicalLoading ? (
                                <LoadingPulse />
                            ) : clinical.allergies.length === 0 ? (
                                <EmptyState label="No known allergies (NKA)" />
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                                    {clinical.allergies.map((a: any, i: number) => (
                                        <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-colors">
                                            <div className="flex items-center gap-2">
                                                {a.criticality === "high" && <span className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />}
                                                {a.criticality === "low" && <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0" />}
                                                <p className="text-sm font-medium text-white/90">
                                                    {a.code?.text || a.code?.coding?.[0]?.display || "Unknown allergen"}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                {a.reaction?.[0]?.manifestation?.[0]?.text && (
                                                    <span className="text-xs text-orange-300/70">
                                                        → {a.reaction[0].manifestation[0].text}
                                                    </span>
                                                )}
                                                {a.criticality && (
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${a.criticality === "high"
                                                        ? "bg-red-500/15 text-red-300"
                                                        : "bg-yellow-500/15 text-yellow-300"
                                                        }`}>
                                                        {a.criticality} criticality
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>

                        {/* Recent Encounters */}
                        <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 flex items-center gap-2">
                                    <span className="text-base">🏥</span> Recent Encounters
                                </h2>
                                <span className="text-xs text-blue-300/30">{clinical.encounters.length} found</span>
                            </div>
                            {clinicalLoading ? (
                                <LoadingPulse />
                            ) : clinical.encounters.length === 0 ? (
                                <EmptyState label="No recent encounters" />
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                                    {clinical.encounters.map((e: any, i: number) => (
                                        <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-4 py-3 hover:bg-white/[0.06] transition-colors">
                                            <div className="flex items-center justify-between">
                                                <p className="text-sm font-medium text-white/90">
                                                    {e.type?.[0]?.text || e.class?.display || e.class?.code || "Visit"}
                                                </p>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${e.status === "finished"
                                                    ? "bg-emerald-500/15 text-emerald-300"
                                                    : e.status === "in-progress"
                                                        ? "bg-blue-500/15 text-blue-300"
                                                        : "bg-slate-500/15 text-slate-400"
                                                    }`}>
                                                    {e.status}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-3 mt-1">
                                                {e.period?.start && (
                                                    <span className="text-xs text-blue-300/40">{shortDate(e.period.start)}</span>
                                                )}
                                                {e.location?.[0]?.location?.display && (
                                                    <span className="text-xs text-blue-300/40">📍 {e.location[0].location.display}</span>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </section>
                    </div>
                )}

                {/* ── Vitals (if available) ── */}
                {!isDemoMode && clinical.observations.length > 0 && (
                    <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 flex items-center gap-2 mb-4">
                            <span className="text-base">📊</span> Recent Vitals
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                            {clinical.observations.map((o: any, i: number) => {
                                const value = o.valueQuantity
                                    ? `${o.valueQuantity.value} ${o.valueQuantity.unit || ""}`
                                    : o.component
                                        ? o.component
                                            .map((c: any) => `${c.valueQuantity?.value ?? "—"}`)
                                            .join("/") + " mmHg"
                                        : "—";
                                return (
                                    <div key={i} className="bg-white/[0.03] border border-white/[0.05] rounded-xl px-4 py-3 text-center">
                                        <p className="text-xs text-blue-300/40 mb-1 truncate">
                                            {o.code?.text || o.code?.coding?.[0]?.display || "Observation"}
                                        </p>
                                        <p className="text-lg font-bold text-white/90">{value}</p>
                                        {o.effectiveDateTime && (
                                            <p className="text-xs text-blue-300/30 mt-1">{shortDate(o.effectiveDateTime)}</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                )}

                {/* ── API Errors (if any) ── */}
                {fetchErrors.length > 0 && (
                    <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                        <p className="text-xs font-semibold text-amber-300 mb-2">⚠ Some clinical data could not be loaded:</p>
                        <ul className="text-xs text-amber-300/70 space-y-1">
                            {fetchErrors.map((err, i) => (
                                <li key={i}>• {err}</li>
                            ))}
                        </ul>
                        <p className="text-xs text-amber-300/40 mt-2">
                            Tip: Add the corresponding APIs to your app at fhir.epic.com → My Apps → API Access
                        </p>
                    </div>
                )}

                {/* ── Find On-Call Provider ── */}
                <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 mb-6">
                        Find On-Call Provider
                    </h2>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <select
                            value={selectedSpecialty}
                            onChange={(e) => setSelectedSpecialty(e.target.value)}
                            className="flex-1 bg-white/[0.06] border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition-all appearance-none cursor-pointer"
                        >
                            {specialties.map((s) => (
                                <option key={s} value={s} className="bg-slate-800">{s}</option>
                            ))}
                        </select>

                        <button
                            onClick={handleFindOnCall}
                            disabled={searching}
                            className="group relative px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 rounded-xl text-sm font-semibold transition-all duration-200 shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 disabled:opacity-50 overflow-hidden"
                        >
                            <span className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
                            {searching ? (
                                <span className="flex items-center gap-2">
                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Searching…
                                </span>
                            ) : (
                                <span className="flex items-center gap-2">
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                    </svg>
                                    Find On-Call Provider
                                </span>
                            )}
                        </button>
                    </div>
                </section>

                {/* ── Schedule Grid ── */}
                <section className="bg-white/[0.04] backdrop-blur-xl border border-white/[0.06] rounded-2xl p-6 shadow-2xl">
                    <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 mb-4">On-Call Schedule</h2>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {[
                            { specialty: "Cardiology", provider: "Dr. Smith", org: "FL Heart Associates", status: "active" },
                            { specialty: "Neurology", provider: "Dr. Chen", org: "NeuroPartners", status: "active" },
                            { specialty: "Orthopedics", provider: "Dr. Williams", org: "BoneWorks Ortho", status: "active" },
                            { specialty: "Pulmonology", provider: "Dr. Patel", org: "Lung & Sleep Center", status: "off" },
                            { specialty: "Gastroenterology", provider: "Dr. Garcia", org: "GI Associates", status: "active" },
                            { specialty: "Nephrology", provider: "Dr. Kim", org: "Kidney Care Group", status: "active" },
                        ].map((item) => (
                            <div
                                key={item.specialty}
                                className="bg-white/[0.03] border border-white/[0.05] rounded-xl p-4 hover:bg-white/[0.06] transition-colors cursor-pointer"
                                onClick={() => setSelectedSpecialty(item.specialty)}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <p className="text-sm font-medium text-white/90">{item.specialty}</p>
                                    <div className={`w-2 h-2 rounded-full ${item.status === "active" ? "bg-emerald-400" : "bg-slate-500"}`} />
                                </div>
                                <p className="text-xs text-blue-300/60">{item.provider}</p>
                                <p className="text-xs text-blue-300/40">{item.org}</p>
                            </div>
                        ))}
                    </div>
                </section>
            </main>

            {/* ── Result Modal ── */}
            {showModal && result && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => { if (!documenting) setShowModal(false); }} />
                    <div className="relative bg-slate-900/95 backdrop-blur-xl border border-white/10 rounded-2xl p-8 max-w-lg w-full mx-4 shadow-2xl animate-in max-h-[90vh] overflow-y-auto">
                        <button onClick={() => { if (!documenting) { setShowModal(false); setShowAuditTrail(false); setAuditLog([]); } }} className="absolute top-4 right-4 text-white/30 hover:text-white/70 transition-colors">
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>

                        <div className="flex items-center gap-2 mb-6">
                            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <h3 className="text-lg font-semibold">Provider Found</h3>
                        </div>

                        <div className="space-y-4 mb-6">
                            <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
                                <p className="text-xs text-blue-300/40 mb-1">On Call — {selectedSpecialty}</p>
                                <p className="text-xl font-bold">{result.name}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
                                    <p className="text-xs text-blue-300/40 mb-1">Organization</p>
                                    <p className="text-sm font-medium">{result.organization}</p>
                                </div>
                                <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-4">
                                    <p className="text-xs text-blue-300/40 mb-1">Contact</p>
                                    <p className="text-sm font-medium">{result.phone}</p>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex gap-3 mb-6">
                            {!isDemoMode ? (
                                <button
                                    onClick={handleDocumentConsult}
                                    disabled={documenting}
                                    className="flex-1 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-xl text-sm font-semibold transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                                >
                                    {documenting ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            Documenting in Epic…
                                        </span>
                                    ) : showAuditTrail && auditLog.length > 0 ? (
                                        "✅ Documented — Run Again"
                                    ) : (
                                        "📋 Contact & Document in Epic"
                                    )}
                                </button>
                            ) : (
                                <button className="flex-1 px-4 py-3 bg-white/[0.06] border border-white/10 rounded-xl text-sm font-medium text-white/40 cursor-not-allowed">
                                    📋 Document in Epic (requires live connection)
                                </button>
                            )}
                            <button
                                onClick={() => { setShowModal(false); setShowAuditTrail(false); setAuditLog([]); }}
                                disabled={documenting}
                                className="px-6 py-3 bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
                            >
                                Close
                            </button>
                        </div>

                        {/* Audit Trail */}
                        {showAuditTrail && auditLog.length > 0 && (
                            <div className="border-t border-white/[0.06] pt-5">
                                <h4 className="text-xs font-semibold uppercase tracking-widest text-blue-300/50 mb-3 flex items-center gap-2">
                                    <span className="text-base">📡</span> Epic FHIR Audit Trail
                                </h4>
                                <div className="space-y-0">
                                    {auditLog.map((entry, i) => (
                                        <div key={i} className="flex gap-3 relative">
                                            {/* Timeline line */}
                                            {i < auditLog.length - 1 && (
                                                <div className="absolute left-[11px] top-6 bottom-0 w-px bg-white/[0.06]" />
                                            )}
                                            {/* Status icon */}
                                            <div className="flex-shrink-0 mt-1">
                                                {entry.status === "pending" && (
                                                    <div className="w-[22px] h-[22px] rounded-full bg-blue-500/10 flex items-center justify-center">
                                                        <div className="w-3 h-3 border-2 border-blue-400/50 border-t-blue-400 rounded-full animate-spin" />
                                                    </div>
                                                )}
                                                {entry.status === "success" && (
                                                    <div className="w-[22px] h-[22px] rounded-full bg-emerald-500/15 flex items-center justify-center">
                                                        <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {entry.status === "verified" && (
                                                    <div className="w-[22px] h-[22px] rounded-full bg-cyan-500/15 flex items-center justify-center">
                                                        <svg className="w-3 h-3 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {entry.status === "error" && (
                                                    <div className="w-[22px] h-[22px] rounded-full bg-red-500/15 flex items-center justify-center">
                                                        <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>
                                            {/* Content */}
                                            <div className="pb-4 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <p className={`text-sm font-medium ${entry.status === "success" ? "text-emerald-300" :
                                                            entry.status === "verified" ? "text-cyan-300" :
                                                                entry.status === "error" ? "text-red-300" :
                                                                    "text-blue-300"
                                                        }`}>
                                                        {entry.action}
                                                    </p>
                                                    <span className="text-xs text-white/20 flex-shrink-0">{entry.timestamp}</span>
                                                </div>
                                                {entry.detail && (
                                                    <p className="text-xs text-white/40 mt-0.5 font-mono break-all">{entry.detail}</p>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                {documenting && (
                                    <p className="text-xs text-blue-300/40 mt-2 animate-pulse">Writing to Epic FHIR server…</p>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ── Shared sub-components ── */
function LoadingPulse() {
    return (
        <div className="space-y-2">
            {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-white/[0.03] rounded-xl animate-pulse" />
            ))}
        </div>
    );
}

function EmptyState({ label }: { label: string }) {
    return (
        <div className="text-center py-6">
            <p className="text-sm text-blue-300/30">{label}</p>
        </div>
    );
}
