import {asyncHandler, logger, modelRouter, Permissions, type TerrenoPlugin} from "@terreno/api";
import type express from "express";
import {Feature} from "../models";

export const featureRoutes = modelRouter("/features", Feature, {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  queryFields: ["name", "status", "groupId"],
  sort: "-created",
});

export class FeatureActionsPlugin implements TerrenoPlugin {
  register(app: express.Application): void {
    // Advance a step to in_progress (checkpoint: marks current step as started)
    app.post(
      "/feature-actions/:id/start-step",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});
        const stepIndex =
          req.body.stepIndex !== undefined ? req.body.stepIndex : feature.currentStepIndex;

        if (stepIndex < 0 || stepIndex >= feature.steps.length) {
          res.status(400).json({error: "Invalid step index"});
          return;
        }

        feature.steps[stepIndex].status = "in_progress";
        feature.steps[stepIndex].startedAt = new Date();
        feature.currentStepIndex = stepIndex;

        if (feature.status !== "in_progress") {
          feature.status = "in_progress";
          feature.startedAt = feature.startedAt ?? new Date();
        }

        await feature.save();
        res.json(feature);
      })
    );

    // Complete a step (checkpoint: persists step result)
    app.post(
      "/feature-actions/:id/complete-step",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});
        const stepIndex =
          req.body.stepIndex !== undefined ? req.body.stepIndex : feature.currentStepIndex;

        if (stepIndex < 0 || stepIndex >= feature.steps.length) {
          res.status(400).json({error: "Invalid step index"});
          return;
        }

        feature.steps[stepIndex].status = "complete";
        feature.steps[stepIndex].completedAt = new Date();
        if (req.body.result) {
          feature.steps[stepIndex].result = req.body.result;
        }

        // Auto-advance currentStepIndex to next pending step
        const nextPending = feature.steps.findIndex(
          (s, i) => i > stepIndex && s.status === "pending"
        );
        if (nextPending >= 0) {
          feature.currentStepIndex = nextPending;
        }

        // Check if all steps are done
        const allDone = feature.steps.every(
          (s) => s.status === "complete" || s.status === "skipped"
        );
        if (allDone) {
          feature.status = "complete";
          feature.completedAt = new Date();
        }

        await feature.save();
        res.json(feature);
      })
    );

    // Fail a step (checkpoint: persists error state)
    app.post(
      "/feature-actions/:id/fail-step",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});
        const stepIndex =
          req.body.stepIndex !== undefined ? req.body.stepIndex : feature.currentStepIndex;

        if (stepIndex < 0 || stepIndex >= feature.steps.length) {
          res.status(400).json({error: "Invalid step index"});
          return;
        }

        feature.steps[stepIndex].status = "error";
        feature.steps[stepIndex].completedAt = new Date();
        feature.steps[stepIndex].errorMessage = req.body.errorMessage || "Unknown error";
        feature.status = "error";
        feature.errorMessage = `Step "${feature.steps[stepIndex].name}" failed: ${req.body.errorMessage || "Unknown error"}`;

        await feature.save();
        res.json(feature);
      })
    );

    // Resume from checkpoint — finds the first non-complete step and continues
    app.post(
      "/feature-actions/:id/resume",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});

        if (feature.status === "complete") {
          res.status(400).json({error: "Feature is already complete"});
          return;
        }

        // Find the first step that isn't complete/skipped
        const resumeIndex = feature.steps.findIndex(
          (s) => s.status !== "complete" && s.status !== "skipped"
        );

        if (resumeIndex < 0) {
          feature.status = "complete";
          feature.completedAt = new Date();
          await feature.save();
          res.json(feature);
          return;
        }

        // Reset error state if resuming from error
        if (feature.steps[resumeIndex].status === "error") {
          feature.steps[resumeIndex].status = "pending";
          feature.steps[resumeIndex].errorMessage = undefined;
        }

        feature.currentStepIndex = resumeIndex;
        feature.status = "in_progress";
        feature.errorMessage = undefined;

        await feature.save();

        logger.info(
          `Feature "${feature.name}" resumed at step ${resumeIndex}: "${feature.steps[resumeIndex].name}"`
        );
        res.json(feature);
      })
    );

    // Pause a feature
    app.post(
      "/feature-actions/:id/pause",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});

        if (feature.status !== "in_progress") {
          res.status(400).json({error: "Feature is not in progress"});
          return;
        }

        feature.status = "paused";
        await feature.save();
        res.json(feature);
      })
    );

    // Get all features that need resuming (were in_progress or error when app stopped)
    app.get(
      "/feature-actions/resumable",
      asyncHandler(async (_req: express.Request, res: express.Response) => {
        const features = await Feature.find({
          status: {$in: ["in_progress", "error"]},
        }).sort({updated: -1});

        res.json({results: features, count: features.length});
      })
    );

    // Get progress summary for a feature
    app.get(
      "/feature-actions/:id/progress",
      asyncHandler(async (req: express.Request, res: express.Response) => {
        const feature = await Feature.findExactlyOne({_id: req.params.id});

        const completedSteps = feature.steps.filter(
          (s) => s.status === "complete" || s.status === "skipped"
        ).length;
        const totalSteps = feature.steps.length;
        const percentage = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
        const currentStep =
          feature.currentStepIndex < feature.steps.length
            ? feature.steps[feature.currentStepIndex]
            : null;

        res.json({
          status: feature.status,
          totalSteps,
          completedSteps,
          percentage,
          currentStepIndex: feature.currentStepIndex,
          currentStepName: currentStep?.name ?? null,
          currentStepStatus: currentStep?.status ?? null,
        });
      })
    );
  }
}
