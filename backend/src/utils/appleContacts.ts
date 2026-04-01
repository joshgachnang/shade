import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {logger} from "@terreno/api";

const execFileAsync = promisify(execFile);

// --- Types ---

export interface AppleContact {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  nickname: string;
  company: string;
  jobTitle: string;
  department: string;
  emails: {label: string; value: string}[];
  phones: {label: string; value: string}[];
  addresses: {
    label: string;
    street: string;
    city: string;
    state: string;
    zip: string;
    country: string;
  }[];
  birthday: string | null;
  note: string;
  groups: string[];
}

export interface ShadeContactContext {
  relationship?: string;
  metAt?: string;
  interests?: string[];
  recentUpdates?: string[];
  preferences?: string[];
  topics?: string[];
  customFields?: Record<string, string>;
}

export interface CreateContactInput {
  firstName: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  emails?: {label: string; value: string}[];
  phones?: {label: string; value: string}[];
  note?: string;
  birthday?: string;
}

export interface UpdateContactInput {
  id: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  note?: string;
}

// --- Notes Format ---
// Human-readable structured notes that live in Apple Contacts' notes field.
// Format:
//
//   Any free-form text the user wrote goes here.
//
//   --- Shade Context ---
//   Relationship: coworker
//   Met: 2025-03-15 at tech conference
//   Interests: hiking, photography, ML
//   Topics: working on new search feature, interested in Rust
//   Preferences: prefers morning meetings, likes concise emails
//   Recent: mentioned moving to Seattle (2025-03)
//   Recent: got promoted to staff engineer (2025-06)
//   custom_field: custom value
//   --- End Shade Context ---

const SHADE_CONTEXT_START = "--- Shade Context ---";
const SHADE_CONTEXT_END = "--- End Shade Context ---";

export const parseShadeContext = (
  note: string
): {userNote: string; context: ShadeContactContext} => {
  const startIdx = note.indexOf(SHADE_CONTEXT_START);
  if (startIdx === -1) {
    return {userNote: note.trim(), context: {}};
  }

  const endIdx = note.indexOf(SHADE_CONTEXT_END);
  const userNote = note.substring(0, startIdx).trim();
  const contextBlock =
    endIdx === -1
      ? note.substring(startIdx + SHADE_CONTEXT_START.length)
      : note.substring(startIdx + SHADE_CONTEXT_START.length, endIdx);

  const context: ShadeContactContext = {};
  const recentUpdates: string[] = [];
  const customFields: Record<string, string> = {};

  const knownKeys = new Set([
    "relationship",
    "met",
    "interests",
    "topics",
    "preferences",
    "recent",
  ]);

  for (const line of contextBlock.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      continue;
    }

    const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
    const value = trimmed.substring(colonIdx + 1).trim();

    if (!value) {
      continue;
    }

    switch (key) {
      case "relationship":
        context.relationship = value;
        break;
      case "met":
        context.metAt = value;
        break;
      case "interests":
        context.interests = value.split(",").map((s) => s.trim());
        break;
      case "topics":
        context.topics = value.split(",").map((s) => s.trim());
        break;
      case "preferences":
        context.preferences = value.split(",").map((s) => s.trim());
        break;
      case "recent":
        recentUpdates.push(value);
        break;
      default:
        if (!knownKeys.has(key)) {
          customFields[key] = value;
        }
        break;
    }
  }

  if (recentUpdates.length > 0) {
    context.recentUpdates = recentUpdates;
  }
  if (Object.keys(customFields).length > 0) {
    context.customFields = customFields;
  }

  return {userNote, context};
};

export const formatShadeContext = (context: ShadeContactContext): string => {
  const lines: string[] = [SHADE_CONTEXT_START];

  if (context.relationship) {
    lines.push(`Relationship: ${context.relationship}`);
  }
  if (context.metAt) {
    lines.push(`Met: ${context.metAt}`);
  }
  if (context.interests && context.interests.length > 0) {
    lines.push(`Interests: ${context.interests.join(", ")}`);
  }
  if (context.topics && context.topics.length > 0) {
    lines.push(`Topics: ${context.topics.join(", ")}`);
  }
  if (context.preferences && context.preferences.length > 0) {
    lines.push(`Preferences: ${context.preferences.join(", ")}`);
  }
  if (context.recentUpdates) {
    for (const update of context.recentUpdates) {
      lines.push(`Recent: ${update}`);
    }
  }
  if (context.customFields) {
    for (const [key, value] of Object.entries(context.customFields)) {
      lines.push(`${key}: ${value}`);
    }
  }

  lines.push(SHADE_CONTEXT_END);
  return lines.join("\n");
};

export const mergeShadeContext = (
  existingNote: string,
  newContext: Partial<ShadeContactContext>
): string => {
  const {userNote, context: existing} = parseShadeContext(existingNote);

  // Merge fields
  const merged: ShadeContactContext = {...existing};

  if (newContext.relationship !== undefined) {
    merged.relationship = newContext.relationship;
  }
  if (newContext.metAt !== undefined) {
    merged.metAt = newContext.metAt;
  }
  if (newContext.interests) {
    const existingSet = new Set(merged.interests ?? []);
    for (const interest of newContext.interests) {
      existingSet.add(interest);
    }
    merged.interests = [...existingSet];
  }
  if (newContext.topics) {
    const existingSet = new Set(merged.topics ?? []);
    for (const topic of newContext.topics) {
      existingSet.add(topic);
    }
    merged.topics = [...existingSet];
  }
  if (newContext.preferences) {
    const existingSet = new Set(merged.preferences ?? []);
    for (const pref of newContext.preferences) {
      existingSet.add(pref);
    }
    merged.preferences = [...existingSet];
  }
  if (newContext.recentUpdates) {
    merged.recentUpdates = [...(merged.recentUpdates ?? []), ...newContext.recentUpdates];
    // Keep only the 10 most recent
    if (merged.recentUpdates.length > 10) {
      merged.recentUpdates = merged.recentUpdates.slice(-10);
    }
  }
  if (newContext.customFields) {
    merged.customFields = {...(merged.customFields ?? {}), ...newContext.customFields};
  }

  const parts: string[] = [];
  if (userNote) {
    parts.push(userNote);
  }
  parts.push("");
  parts.push(formatShadeContext(merged));

  return parts.join("\n").trim();
};

// --- JXA helpers ---

const runJxa = async (script: string): Promise<string> => {
  try {
    const {stdout} = await execFileAsync("osascript", ["-l", "JavaScript", "-e", script], {
      timeout: 30_000,
    });
    return stdout.trim();
  } catch (error) {
    logger.error(`Apple Contacts JXA failed: ${error}`);
    throw new Error(`Apple Contacts script failed: ${(error as Error).message}`);
  }
};

const escapeJxaString = (s: string): string => {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
};

// --- Contact operations ---

export const listAllContacts = async (): Promise<AppleContact[]> => {
  const script = `
    const app = Application("Contacts");
    const people = app.people();
    JSON.stringify(people.map(p => {
      let emails = [];
      try { emails = p.emails().map(e => ({label: e.label(), value: e.value()})); } catch(e) {}
      let phones = [];
      try { phones = p.phones().map(ph => ({label: ph.label(), value: ph.value()})); } catch(e) {}
      let addresses = [];
      try {
        addresses = p.addresses().map(a => ({
          label: a.label(),
          street: a.street() || "",
          city: a.city() || "",
          state: a.state() || "",
          zip: a.zip() || "",
          country: a.country() || ""
        }));
      } catch(e) {}
      let groups = [];
      try { groups = app.groups.whose({_match: [Application("Contacts").people.id, p.id()]})().map(g => g.name()); } catch(e) {}

      return {
        id: p.id(),
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
        nickname: p.nickname() || "",
        company: p.organization() || "",
        jobTitle: p.jobTitle() || "",
        department: p.department() || "",
        emails: emails,
        phones: phones,
        addresses: addresses,
        birthday: p.birthDate() ? p.birthDate().toISOString() : null,
        note: p.note() || "",
        groups: groups
      };
    }));
  `;
  const result = await runJxa(script);
  if (!result) {
    return [];
  }
  return JSON.parse(result);
};

export const searchContacts = async (query: string): Promise<AppleContact[]> => {
  // Search across name, email, phone, company, and notes
  const queryEscaped = escapeJxaString(query.toLowerCase());
  const script = `
    const app = Application("Contacts");
    const people = app.people();
    const query = "${queryEscaped}";
    const matches = people.filter(p => {
      const first = (p.firstName() || "").toLowerCase();
      const last = (p.lastName() || "").toLowerCase();
      const full = first + " " + last;
      const nick = (p.nickname() || "").toLowerCase();
      const org = (p.organization() || "").toLowerCase();
      const note = (p.note() || "").toLowerCase();

      if (full.includes(query) || first.includes(query) || last.includes(query) ||
          nick.includes(query) || org.includes(query) || note.includes(query)) {
        return true;
      }

      try {
        const emails = p.emails().map(e => e.value().toLowerCase());
        if (emails.some(e => e.includes(query))) return true;
      } catch(e) {}

      try {
        const phones = p.phones().map(ph => ph.value().replace(/[^0-9+]/g, ""));
        const queryDigits = query.replace(/[^0-9+]/g, "");
        if (queryDigits.length >= 4 && phones.some(ph => ph.includes(queryDigits))) return true;
      } catch(e) {}

      return false;
    });

    JSON.stringify(matches.map(p => {
      let emails = [];
      try { emails = p.emails().map(e => ({label: e.label(), value: e.value()})); } catch(e) {}
      let phones = [];
      try { phones = p.phones().map(ph => ({label: ph.label(), value: ph.value()})); } catch(e) {}
      let addresses = [];
      try {
        addresses = p.addresses().map(a => ({
          label: a.label(),
          street: a.street() || "",
          city: a.city() || "",
          state: a.state() || "",
          zip: a.zip() || "",
          country: a.country() || ""
        }));
      } catch(e) {}

      return {
        id: p.id(),
        firstName: p.firstName() || "",
        lastName: p.lastName() || "",
        fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
        nickname: p.nickname() || "",
        company: p.organization() || "",
        jobTitle: p.jobTitle() || "",
        department: p.department() || "",
        emails: emails,
        phones: phones,
        addresses: addresses,
        birthday: p.birthDate() ? p.birthDate().toISOString() : null,
        note: p.note() || "",
        groups: []
      };
    }));
  `;
  const result = await runJxa(script);
  if (!result) {
    return [];
  }
  return JSON.parse(result);
};

export const getContactById = async (id: string): Promise<AppleContact | null> => {
  const idEscaped = escapeJxaString(id);
  const script = `
    const app = Application("Contacts");
    try {
      const p = app.people.byId("${idEscaped}");
      // Force evaluation to check existence
      const firstName = p.firstName();

      let emails = [];
      try { emails = p.emails().map(e => ({label: e.label(), value: e.value()})); } catch(e) {}
      let phones = [];
      try { phones = p.phones().map(ph => ({label: ph.label(), value: ph.value()})); } catch(e) {}
      let addresses = [];
      try {
        addresses = p.addresses().map(a => ({
          label: a.label(),
          street: a.street() || "",
          city: a.city() || "",
          state: a.state() || "",
          zip: a.zip() || "",
          country: a.country() || ""
        }));
      } catch(e) {}

      JSON.stringify({
        id: p.id(),
        firstName: firstName || "",
        lastName: p.lastName() || "",
        fullName: (firstName || "") + (firstName && p.lastName() ? " " : "") + (p.lastName() || ""),
        nickname: p.nickname() || "",
        company: p.organization() || "",
        jobTitle: p.jobTitle() || "",
        department: p.department() || "",
        emails: emails,
        phones: phones,
        addresses: addresses,
        birthday: p.birthDate() ? p.birthDate().toISOString() : null,
        note: p.note() || "",
        groups: []
      });
    } catch(e) {
      "null";
    }
  `;
  const result = await runJxa(script);
  if (!result || result === "null") {
    return null;
  }
  return JSON.parse(result);
};

export const createContact = async (input: CreateContactInput): Promise<AppleContact> => {
  const firstEscaped = escapeJxaString(input.firstName);
  const lastEscaped = escapeJxaString(input.lastName ?? "");
  const companyEscaped = escapeJxaString(input.company ?? "");
  const jobTitleEscaped = escapeJxaString(input.jobTitle ?? "");
  const noteEscaped = escapeJxaString(input.note ?? "");

  let emailSetup = "";
  if (input.emails && input.emails.length > 0) {
    const emailLines = input.emails.map(
      (e) =>
        `app.Email({label: "${escapeJxaString(e.label)}", value: "${escapeJxaString(e.value)}"})`
    );
    emailSetup = `
      const emails = [${emailLines.join(", ")}];
      for (const em of emails) { p.emails.push(em); }
    `;
  }

  let phoneSetup = "";
  if (input.phones && input.phones.length > 0) {
    const phoneLines = input.phones.map(
      (p) =>
        `app.Phone({label: "${escapeJxaString(p.label)}", value: "${escapeJxaString(p.value)}"})`
    );
    phoneSetup = `
      const phones = [${phoneLines.join(", ")}];
      for (const ph of phones) { p.phones.push(ph); }
    `;
  }

  const script = `
    const app = Application("Contacts");
    const p = app.Person({
      firstName: "${firstEscaped}",
      lastName: "${lastEscaped}",
      organization: "${companyEscaped}",
      jobTitle: "${jobTitleEscaped}",
      note: "${noteEscaped}"
    });
    app.people.push(p);
    ${emailSetup}
    ${phoneSetup}
    app.save();
    JSON.stringify({
      id: p.id(),
      firstName: p.firstName() || "",
      lastName: p.lastName() || "",
      fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
      nickname: "",
      company: p.organization() || "",
      jobTitle: p.jobTitle() || "",
      department: "",
      emails: ${input.emails ? "p.emails().map(e => ({label: e.label(), value: e.value()}))" : "[]"},
      phones: ${input.phones ? "p.phones().map(ph => ({label: ph.label(), value: ph.value()}))" : "[]"},
      addresses: [],
      birthday: null,
      note: p.note() || "",
      groups: []
    });
  `;
  const result = await runJxa(script);
  return JSON.parse(result);
};

export const updateContact = async (input: UpdateContactInput): Promise<AppleContact> => {
  const idEscaped = escapeJxaString(input.id);

  const setLines: string[] = [];
  if (input.firstName !== undefined) {
    setLines.push(`p.firstName = "${escapeJxaString(input.firstName)}";`);
  }
  if (input.lastName !== undefined) {
    setLines.push(`p.lastName = "${escapeJxaString(input.lastName)}";`);
  }
  if (input.company !== undefined) {
    setLines.push(`p.organization = "${escapeJxaString(input.company)}";`);
  }
  if (input.jobTitle !== undefined) {
    setLines.push(`p.jobTitle = "${escapeJxaString(input.jobTitle)}";`);
  }
  if (input.note !== undefined) {
    setLines.push(`p.note = "${escapeJxaString(input.note)}";`);
  }

  const script = `
    const app = Application("Contacts");
    const p = app.people.byId("${idEscaped}");
    ${setLines.join("\n    ")}
    app.save();

    let emails = [];
    try { emails = p.emails().map(e => ({label: e.label(), value: e.value()})); } catch(e) {}
    let phones = [];
    try { phones = p.phones().map(ph => ({label: ph.label(), value: ph.value()})); } catch(e) {}

    JSON.stringify({
      id: p.id(),
      firstName: p.firstName() || "",
      lastName: p.lastName() || "",
      fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
      nickname: p.nickname() || "",
      company: p.organization() || "",
      jobTitle: p.jobTitle() || "",
      department: p.department() || "",
      emails: emails,
      phones: phones,
      addresses: [],
      birthday: p.birthDate() ? p.birthDate().toISOString() : null,
      note: p.note() || "",
      groups: []
    });
  `;
  const result = await runJxa(script);
  return JSON.parse(result);
};

export const updateContactNote = async (id: string, note: string): Promise<AppleContact> => {
  return updateContact({id, note});
};

export const addShadeContext = async (
  id: string,
  context: Partial<ShadeContactContext>
): Promise<AppleContact> => {
  const contact = await getContactById(id);
  if (!contact) {
    throw new Error(`Contact not found: ${id}`);
  }

  const newNote = mergeShadeContext(contact.note, context);
  return updateContactNote(id, newNote);
};

export const listGroups = async (): Promise<{name: string; id: string; count: number}[]> => {
  const script = `
    const app = Application("Contacts");
    const groups = app.groups();
    JSON.stringify(groups.map(g => ({
      name: g.name(),
      id: g.id(),
      count: g.people().length
    })));
  `;
  const result = await runJxa(script);
  if (!result) {
    return [];
  }
  return JSON.parse(result);
};

export const matchContactByEmail = async (email: string): Promise<AppleContact | null> => {
  const emailEscaped = escapeJxaString(email.toLowerCase());
  const script = `
    const app = Application("Contacts");
    const people = app.people();
    const target = "${emailEscaped}";
    let match = null;
    for (const p of people) {
      try {
        const emails = p.emails().map(e => e.value().toLowerCase());
        if (emails.includes(target)) {
          let phones = [];
          try { phones = p.phones().map(ph => ({label: ph.label(), value: ph.value()})); } catch(e) {}
          match = {
            id: p.id(),
            firstName: p.firstName() || "",
            lastName: p.lastName() || "",
            fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
            nickname: p.nickname() || "",
            company: p.organization() || "",
            jobTitle: p.jobTitle() || "",
            department: p.department() || "",
            emails: p.emails().map(e => ({label: e.label(), value: e.value()})),
            phones: phones,
            addresses: [],
            birthday: p.birthDate() ? p.birthDate().toISOString() : null,
            note: p.note() || "",
            groups: []
          };
          break;
        }
      } catch(e) {}
    }
    JSON.stringify(match);
  `;
  const result = await runJxa(script);
  if (!result || result === "null") {
    return null;
  }
  return JSON.parse(result);
};

export const matchContactByPhone = async (phone: string): Promise<AppleContact | null> => {
  // Normalize to digits only for matching
  const digits = phone.replace(/[^0-9+]/g, "");
  const digitsEscaped = escapeJxaString(digits);
  const script = `
    const app = Application("Contacts");
    const people = app.people();
    const target = "${digitsEscaped}";
    let match = null;
    for (const p of people) {
      try {
        const phones = p.phones().map(ph => ph.value().replace(/[^0-9+]/g, ""));
        // Match last 10 digits to handle country code differences
        const targetTail = target.slice(-10);
        if (phones.some(ph => ph.slice(-10) === targetTail)) {
          let emails = [];
          try { emails = p.emails().map(e => ({label: e.label(), value: e.value()})); } catch(e) {}
          match = {
            id: p.id(),
            firstName: p.firstName() || "",
            lastName: p.lastName() || "",
            fullName: (p.firstName() || "") + (p.firstName() && p.lastName() ? " " : "") + (p.lastName() || ""),
            nickname: p.nickname() || "",
            company: p.organization() || "",
            jobTitle: p.jobTitle() || "",
            department: p.department() || "",
            emails: emails,
            phones: p.phones().map(ph => ({label: ph.label(), value: ph.value()})),
            addresses: [],
            birthday: p.birthDate() ? p.birthDate().toISOString() : null,
            note: p.note() || "",
            groups: []
          };
          break;
        }
      } catch(e) {}
    }
    JSON.stringify(match);
  `;
  const result = await runJxa(script);
  if (!result || result === "null") {
    return null;
  }
  return JSON.parse(result);
};
