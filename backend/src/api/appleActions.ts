import type {TerrenoPlugin} from "@terreno/api";
import {APIError, asyncHandler, authenticateMiddleware, logger} from "@terreno/api";
import type {Request, Response} from "express";
import mongoose from "mongoose";
import {resolveTargetName} from "../agentRunner/appleTools";
import {queueEdgeCommand} from "../edge/commands";
import {AppleCalendar} from "../models/appleCalendarModel";
import {Reminder} from "../models/reminder";
import {ReminderList} from "../models/reminderList";

/**
 * Action routes for the reminders/calendar management UI.
 *
 * Mutations must round-trip through the iMessage edge agent (which owns the
 * Mac's EventKit stores) — a direct DB write would be overwritten by the next
 * sync. Each action queues an edge command and applies the same optimistic
 * local update the MCP tools use, so the UI reflects the change immediately.
 *
 * POST /apple/reminders               — create a reminder
 * POST /apple/reminders/:id/complete  — mark a reminder completed
 * POST /apple/reminders/:id/remove    — delete a reminder
 * POST /apple/calendar-events         — create a calendar event
 * POST /apple/sync                    — request an immediate full re-sync
 *
 * Reads use the CRUD routes (/reminders, /reminderLists, /appleCalendars,
 * /calendarEvents) registered in crudRoutes.ts.
 */
export class AppleActionsPlugin implements TerrenoPlugin {
  register(app: import("express").Application): void {
    app.post(
      "/apple/reminders",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const {title, listName, notes, dueDate, priority} = req.body as {
          title?: string;
          listName?: string;
          notes?: string;
          dueDate?: string;
          priority?: number;
        };

        if (!title || title.trim().length === 0) {
          throw new APIError({status: 400, title: "title is required"});
        }

        const lists = await ReminderList.find({}).lean();
        const resolved = resolveTargetName(listName, lists);
        if (resolved.error) {
          throw new APIError({status: 400, title: resolved.error});
        }

        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "create_reminder",
          payload: {
            title: title.trim(),
            listName: resolved.match,
            notes,
            dueDate,
            priority: priority || undefined,
          },
        });

        logger.info(`UI queued reminder "${title}" via agent "${agentName}" (${commandId})`);
        res.status(202).json({data: {commandId, agentName, listName: resolved.match ?? null}});
      })
    );

    app.post(
      "/apple/reminders/:id/complete",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const reminder = await findReminderById(req.params.id);

        const {commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "complete_reminder",
          payload: {externalId: reminder.externalId},
        });

        reminder.completed = true;
        reminder.completedAt = new Date();
        await reminder.save();

        res.json({data: {commandId, reminderId: reminder._id.toString()}});
      })
    );

    app.post(
      "/apple/reminders/:id/remove",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const reminder = await findReminderById(req.params.id);

        const {commandId} = await queueEdgeCommand({
          capability: "manage_reminders",
          type: "delete_reminder",
          payload: {externalId: reminder.externalId},
        });

        reminder.syncStatus = "removed";
        await reminder.save();

        res.json({data: {commandId, reminderId: reminder._id.toString()}});
      })
    );

    app.post(
      "/apple/calendar-events",
      authenticateMiddleware(),
      asyncHandler(async (req: Request, res: Response) => {
        const {title, calendarName, startDate, endDate, allDay, location, notes} = req.body as {
          title?: string;
          calendarName?: string;
          startDate?: string;
          endDate?: string;
          allDay?: boolean;
          location?: string;
          notes?: string;
        };

        if (!title || !startDate || !endDate) {
          throw new APIError({status: 400, title: "title, startDate, and endDate are required"});
        }

        const calendars = await AppleCalendar.find({writable: true}).lean();
        const resolved = resolveTargetName(calendarName, calendars);
        if (resolved.error) {
          throw new APIError({status: 400, title: resolved.error});
        }

        const {agentName, commandId} = await queueEdgeCommand({
          capability: "manage_calendar",
          type: "create_calendar_event",
          payload: {
            title: title.trim(),
            calendarName: resolved.match,
            startDate,
            endDate,
            allDay,
            location,
            notes,
          },
        });

        logger.info(`UI queued event "${title}" via agent "${agentName}" (${commandId})`);
        res.status(202).json({data: {commandId, agentName, calendarName: resolved.match ?? null}});
      })
    );

    app.post(
      "/apple/sync",
      authenticateMiddleware(),
      asyncHandler(async (_req: Request, res: Response) => {
        const {agentName, commandId} = await queueEdgeCommand({
          capability: "sync_reminders",
          type: "sync_now",
          payload: {},
        });
        res.status(202).json({data: {commandId, agentName}});
      })
    );
  }
}

const findReminderById = async (id: string) => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new APIError({status: 404, title: "Reminder not found"});
  }
  const reminder = await Reminder.findOneOrNone({_id: id});
  if (!reminder) {
    throw new APIError({status: 404, title: "Reminder not found"});
  }
  return reminder;
};
