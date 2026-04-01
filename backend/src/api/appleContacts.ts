import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import type {UserDocument} from "../types";
import {
  addShadeContext,
  createContact,
  getContactById,
  listAllContacts,
  listGroups,
  matchContactByEmail,
  matchContactByPhone,
  searchContacts,
  updateContact,
} from "../utils/appleContacts";

/**
 * Apple Contacts integration routes:
 *
 * GET    /apple-contacts                          — List all contacts
 * GET    /apple-contacts/search?q=                — Search contacts by name/email/phone/company/notes
 * GET    /apple-contacts/groups                   — List contact groups
 * GET    /apple-contacts/match?email=&phone=      — Match a contact by email or phone
 * GET    /apple-contacts/:id                      — Get a single contact by ID
 * POST   /apple-contacts                          — Create a new contact
 * PATCH  /apple-contacts/:id                      — Update a contact's fields
 * POST   /apple-contacts/:id/context              — Add/merge Shade context to a contact's notes
 */
export class AppleContactsPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    // List all contacts
    app.get(
      "/apple-contacts",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const contacts = await listAllContacts();
        res.json({data: contacts, count: contacts.length});
      })
    );

    // Search contacts
    app.get(
      "/apple-contacts/search",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const {q} = req.query as {q?: string};
        if (!q) {
          throw new APIError({status: 400, title: "q query parameter is required"});
        }
        const contacts = await searchContacts(q);
        res.json({data: contacts, count: contacts.length});
      })
    );

    // List contact groups
    app.get(
      "/apple-contacts/groups",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const groups = await listGroups();
        res.json({data: groups});
      })
    );

    // Match contact by email or phone
    app.get(
      "/apple-contacts/match",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const {email, phone} = req.query as {email?: string; phone?: string};
        if (!email && !phone) {
          throw new APIError({
            status: 400,
            title: "Either email or phone query parameter is required",
          });
        }

        let contact = null;
        if (email) {
          contact = await matchContactByEmail(email);
        }
        if (!contact && phone) {
          contact = await matchContactByPhone(phone);
        }

        res.json({data: contact});
      })
    );

    // Get a single contact by ID
    app.get(
      "/apple-contacts/:id",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const contact = await getContactById(req.params.id);
        if (!contact) {
          throw new APIError({status: 404, title: "Contact not found"});
        }
        res.json({data: contact});
      })
    );

    // Create a new contact
    app.post(
      "/apple-contacts",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as UserDocument | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const {firstName, lastName, company, jobTitle, emails, phones, note, birthday} =
          req.body as {
            firstName?: string;
            lastName?: string;
            company?: string;
            jobTitle?: string;
            emails?: {label: string; value: string}[];
            phones?: {label: string; value: string}[];
            note?: string;
            birthday?: string;
          };

        if (!firstName) {
          throw new APIError({status: 400, title: "firstName is required"});
        }

        logger.info(`Creating contact "${firstName} ${lastName ?? ""}" for ${user.name}`);
        const contact = await createContact({
          firstName,
          lastName,
          company,
          jobTitle,
          emails,
          phones,
          note,
          birthday,
        });

        res.status(201).json({data: contact});
      })
    );

    // Update a contact
    app.patch(
      "/apple-contacts/:id",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as UserDocument | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const {firstName, lastName, company, jobTitle, note} = req.body as {
          firstName?: string;
          lastName?: string;
          company?: string;
          jobTitle?: string;
          note?: string;
        };

        logger.info(`Updating contact ${req.params.id} for ${user.name}`);
        const contact = await updateContact({
          id: req.params.id,
          firstName,
          lastName,
          company,
          jobTitle,
          note,
        });

        res.json({data: contact});
      })
    );

    // Add/merge Shade context to a contact's notes
    app.post(
      "/apple-contacts/:id/context",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = req.user as UserDocument | undefined;
        if (!user) {
          throw new APIError({status: 401, title: "Authentication required"});
        }

        const {relationship, metAt, interests, topics, preferences, recentUpdates, customFields} =
          req.body as {
            relationship?: string;
            metAt?: string;
            interests?: string[];
            topics?: string[];
            preferences?: string[];
            recentUpdates?: string[];
            customFields?: Record<string, string>;
          };

        logger.info(`Adding Shade context to contact ${req.params.id} for ${user.name}`);
        const contact = await addShadeContext(req.params.id, {
          relationship,
          metAt,
          interests,
          topics,
          preferences,
          recentUpdates,
          customFields,
        });

        res.json({data: contact});
      })
    );
  }
}
