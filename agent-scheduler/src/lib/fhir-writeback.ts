import Client from "fhirclient/lib/Client";

export interface AuditEntry {
    timestamp: string;
    action: string;
    status: "pending" | "success" | "error" | "verified";
    detail?: string;
    resourceId?: string;
}

/**
 * Write a Communication resource to Epic FHIR,
 * documenting that a consult call was made.
 */
export async function documentConsultCall(
    fhirClient: Client,
    opts: {
        patientId: string;
        consultantName: string;
        specialty: string;
        organization: string;
        contactMethod: string;
        onAudit: (entry: AuditEntry) => void;
    }
): Promise<void> {
    const { patientId, consultantName, specialty, organization, contactMethod, onAudit } = opts;
    const now = new Date().toISOString();

    // Step 1: Create Communication resource
    onAudit({
        timestamp: new Date().toLocaleTimeString(),
        action: `Creating Communication — consult call to ${consultantName}`,
        status: "pending",
    });

    let commId: string | null = null;
    try {
        const communication = {
            resourceType: "Communication",
            status: "completed",
            subject: { reference: `Patient/${patientId}` },
            sent: now,
            category: [
                {
                    coding: [
                        {
                            system: "http://terminology.hl7.org/CodeSystem/communication-category",
                            code: "notification",
                            display: "Notification",
                        },
                    ],
                    text: "Consult Call",
                },
            ],
            payload: [
                {
                    contentString: `On-call ${specialty} consult: Contacted ${consultantName} at ${organization} via ${contactMethod}. Call initiated by scheduling agent at ${new Date().toLocaleString()}.`,
                },
            ],
        };

        const result = await fhirClient.create(communication as any);
        commId = result?.id || null;

        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Communication created in EHR",
            status: "success",
            detail: commId ? `Resource ID: ${commId}` : "Created (no ID returned)",
            resourceId: commId || undefined,
        });
    } catch (e: any) {
        const msg = e?.statusCode === 403
            ? "Not authorized — add Communication.Create API to your Epic app"
            : e?.message || "Write failed";
        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Communication.Create",
            status: "error",
            detail: msg,
        });
    }

    // Step 2: Verify by reading back
    if (commId) {
        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Verifying — reading Communication back from Epic",
            status: "pending",
        });

        try {
            const readBack = await fhirClient.request(`Communication/${commId}`);
            onAudit({
                timestamp: new Date().toLocaleTimeString(),
                action: "Read-back confirmed from Epic FHIR server",
                status: "verified",
                detail: `Status: ${readBack.status}, Sent: ${readBack.sent}`,
                resourceId: commId,
            });
        } catch (e: any) {
            onAudit({
                timestamp: new Date().toLocaleTimeString(),
                action: "Read-back verification",
                status: "error",
                detail: e?.message || "Could not verify",
            });
        }
    }

    // Step 3: Create a Task to track the consult
    onAudit({
        timestamp: new Date().toLocaleTimeString(),
        action: `Creating Task — ${specialty} consult follow-up`,
        status: "pending",
    });

    let taskId: string | null = null;
    try {
        const task = {
            resourceType: "Task",
            status: "completed",
            intent: "order",
            description: `${specialty} consult — ${consultantName} at ${organization} contacted via ${contactMethod}`,
            for: { reference: `Patient/${patientId}` },
            authoredOn: now,
            lastModified: now,
            code: {
                coding: [
                    {
                        system: "http://hl7.org/fhir/CodeSystem/task-code",
                        code: "fulfill",
                        display: "Fulfill",
                    },
                ],
                text: `${specialty} Consult Call`,
            },
        };

        const result = await fhirClient.create(task as any);
        taskId = result?.id || null;

        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Task created and marked completed",
            status: "success",
            detail: taskId ? `Resource ID: ${taskId}` : "Created (no ID returned)",
            resourceId: taskId || undefined,
        });
    } catch (e: any) {
        const msg = e?.statusCode === 403
            ? "Not authorized — add Task.Create API to your Epic app"
            : e?.message || "Write failed";
        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Task.Create",
            status: "error",
            detail: msg,
        });
    }

    // Step 4: Verify task
    if (taskId) {
        onAudit({
            timestamp: new Date().toLocaleTimeString(),
            action: "Verifying — reading Task back from Epic",
            status: "pending",
        });

        try {
            const readBack = await fhirClient.request(`Task/${taskId}`);
            onAudit({
                timestamp: new Date().toLocaleTimeString(),
                action: "Task read-back confirmed from Epic FHIR server",
                status: "verified",
                detail: `Status: ${readBack.status}, Intent: ${readBack.intent}`,
                resourceId: taskId,
            });
        } catch (e: any) {
            onAudit({
                timestamp: new Date().toLocaleTimeString(),
                action: "Task read-back verification",
                status: "error",
                detail: e?.message || "Could not verify",
            });
        }
    }

    // Final summary
    const hasAnySuccess = commId || taskId;
    onAudit({
        timestamp: new Date().toLocaleTimeString(),
        action: hasAnySuccess
            ? "Agent workflow complete — documented in Epic"
            : "Agent workflow complete — write operations not available in sandbox config",
        status: hasAnySuccess ? "success" : "error",
        detail: hasAnySuccess
            ? `${commId ? "Communication ✓" : ""} ${taskId ? "Task ✓" : ""}`.trim()
            : "Add Communication.Create and Task.Create APIs to your Epic app at fhir.epic.com",
    });
}
