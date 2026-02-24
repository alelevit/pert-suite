// Minimal FHIR R4 type declarations for Patient and Practitioner
declare namespace fhir4 {
    interface HumanName {
        use?: string;
        text?: string;
        family?: string;
        given?: string[];
        prefix?: string[];
        suffix?: string[];
    }

    interface Identifier {
        use?: string;
        type?: { text?: string; coding?: { system?: string; code?: string }[] };
        system?: string;
        value?: string;
    }

    interface Patient {
        resourceType: "Patient";
        id?: string;
        name?: HumanName[];
        birthDate?: string;
        gender?: string;
        identifier?: Identifier[];
        [key: string]: unknown;
    }

    interface Practitioner {
        resourceType: "Practitioner";
        id?: string;
        name?: HumanName[];
        [key: string]: unknown;
    }
}
