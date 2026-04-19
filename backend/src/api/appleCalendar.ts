import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import {CalendarConfig} from "../models/calendarConfig";
import {createEvent, getEvents, listCalendars} from "../utils/appleCalendar";
import {requireUser} from "../utils/auth";

/**
 * Apple Calendar integration routes:
 *
 * GET  /apple-calendar/calendars           — List all calendars from Calendar.app
 * GET  /apple-calendar/events?start=&end=  — Get events from enabled calendars
 * POST /apple-calendar/events              — Create a new event
 *
 * CRUD /calendar-configs is registered via crudRoutes.
 */
export class AppleCalendarPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    // List all Apple Calendar calendars available on this machine
    app.get(
      "/apple-calendar/calendars",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const calendars = await listCalendars();
        res.json({data: calendars});
      })
    );

    // Get events from enabled calendars within a date range
    app.get(
      "/apple-calendar/events",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = requireUser(req);

        const {start, end, calendars} = req.query as {
          start?: string;
          end?: string;
          calendars?: string;
        };

        if (!start || !end) {
          throw new APIError({
            status: 400,
            title: "start and end query parameters are required (ISO 8601 format)",
          });
        }

        // Determine which calendars to query
        let calendarNames: string[];
        if (calendars) {
          // Explicit override via query param
          calendarNames = calendars.split(",").map((c) => c.trim());
        } else {
          // Fall back to user's saved config
          const config = await CalendarConfig.findOne({owner: user._id});
          if (!config || config.enabledCalendars.length === 0) {
            throw new APIError({
              status: 400,
              title:
                "No calendars configured. Set enabled calendars via POST /calendar-configs or pass ?calendars=Cal1,Cal2",
            });
          }
          calendarNames = config.enabledCalendars;
        }

        logger.debug(`Fetching events from calendars: ${calendarNames.join(", ")}`);
        const events = await getEvents({calendarNames, startDate: start, endDate: end});
        res.json({data: events});
      })
    );

    // Create a new event in Apple Calendar
    app.post(
      "/apple-calendar/events",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const user = requireUser(req);

        const {summary, startDate, endDate, calendarName, location, notes, isAllDay} = req.body as {
          summary?: string;
          startDate?: string;
          endDate?: string;
          calendarName?: string;
          location?: string;
          notes?: string;
          isAllDay?: boolean;
        };

        if (!summary || !startDate || !endDate || !calendarName) {
          throw new APIError({
            status: 400,
            title: "summary, startDate, endDate, and calendarName are required",
          });
        }

        logger.info(`Creating calendar event "${summary}" in "${calendarName}" for ${user.name}`);
        const event = await createEvent({
          summary,
          startDate,
          endDate,
          calendarName,
          location,
          notes,
          isAllDay,
        });

        res.status(201).json({data: event});
      })
    );
  }
}
