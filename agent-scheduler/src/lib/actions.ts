"use server";

export interface OnCallResult {
    name: string;
    phone: string;
    contactMethod: "phone" | "sms" | "pager";
    organization: string;
    specialty: string;
}

// ───────────────────────────────────────────────────────
// Mock Schedule Data
// This simulates the "messy schedule" that varies by
// vendor, specialty, and hospital department.
// In Phase 5 this will be replaced by an LLM call.
// ───────────────────────────────────────────────────────

const MOCK_SCHEDULE: Record<string, OnCallResult> = {
    Cardiology: {
        name: "Dr. Sarah Smith",
        phone: "555-0199",
        contactMethod: "phone",
        organization: "FL Heart Associates",
        specialty: "Cardiology",
    },
    Neurology: {
        name: "Dr. Michael Chen",
        phone: "555-0234",
        contactMethod: "sms",
        organization: "NeuroPartners",
        specialty: "Neurology",
    },
    Orthopedics: {
        name: "Dr. Angela Williams",
        phone: "555-0345",
        contactMethod: "phone",
        organization: "BoneWorks Ortho",
        specialty: "Orthopedics",
    },
    Pulmonology: {
        name: "Dr. Raj Patel",
        phone: "555-0456",
        contactMethod: "pager",
        organization: "Lung & Sleep Center",
        specialty: "Pulmonology",
    },
    Gastroenterology: {
        name: "Dr. Maria Garcia",
        phone: "555-0567",
        contactMethod: "sms",
        organization: "GI Associates",
        specialty: "Gastroenterology",
    },
    Nephrology: {
        name: "Dr. David Kim",
        phone: "555-0678",
        contactMethod: "phone",
        organization: "Kidney Care Group",
        specialty: "Nephrology",
    },
};

/**
 * Server Action: Find the on-call provider for a given specialty.
 *
 * Phase 4 (current): Uses hardcoded mock schedule data.
 * Phase 5 (future):  Will call an LLM (GPT-4o via OpenAI SDK)
 *                    to parse dynamic schedule data.
 */
export async function findOnCallProvider(
    specialty: string,
    _location: string
): Promise<OnCallResult> {
    // Simulate network latency (remove in production)
    await new Promise((resolve) => setTimeout(resolve, 800));

    const result = MOCK_SCHEDULE[specialty];

    if (!result) {
        return {
            name: "Unknown Provider",
            phone: "N/A",
            contactMethod: "phone",
            organization: "N/A",
            specialty,
        };
    }

    // ─── AI Integration Placeholder ─────────────────────
    // TODO (Phase 5): Replace mock lookup with LLM call:
    //
    // import OpenAI from 'openai';
    // const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    //
    // const completion = await openai.chat.completions.create({
    //   model: "gpt-4o",
    //   messages: [{
    //     role: "system",
    //     content: `You are an expert hospital scheduler. Given the
    //       following schedule data: ${JSON.stringify(MOCK_SCHEDULE)},
    //       determine who is on call for "${specialty}" at "${location}".
    //       Return JSON: {name, phone, contactMethod, organization, specialty}`
    //   }],
    //   response_format: { type: "json_object" }
    // });
    //
    // return JSON.parse(completion.choices[0].message.content);
    // ─────────────────────────────────────────────────────

    return result;
}
