// Apply a human reply, from any channel, then say whether the run can continue.
import { formatAsks, parseReply } from "../human.ts";
import { appendEvent } from "../events.ts";
import { applyReplyBody } from "../prompts.ts";
import { appendContext, saveState } from "../state.ts";
import { runStage, type Ctx } from "../step.ts";
import { approve, cutAndFix, sendForSignoff } from "./distill.ts";

export type AnswerOutcome = "approved" | "waiting" | "continue" | "stopped";

export const answer = async (ctx: Ctx, reply: string): Promise<AnswerOutcome> => {
  const { state } = ctx;
  const waiting = state.waiting;
  if (!waiting) throw new Error(`brewery: ${state.slug} is not waiting on an answer (phase ${state.phase}).`);
  appendEvent(state, { kind: "resumed" });
  appendEvent(state, { kind: "note", text: reply });
  const at = new Date().toISOString();
  appendContext(state, `Human reply (${at.slice(0, 16)})`, `Questions asked:\n${formatAsks(waiting.asks) || "(none)"}\n\nReply:\n${reply}`);
  state.answers.push({ q: waiting.asks.map((a) => a.q).join(" / ") || waiting.message.split("\n")[0], a: reply, at });
  saveState(state);

  if (waiting.kind === "signoff") {
    const verdict = parseReply(reply);
    const [{ result }] = await runStage(ctx, "distill", applyReplyBody(ctx, waiting.asks, reply, verdict));
    state.waiting = undefined;
    if (verdict === "approve") {
      if (result.structural) await cutAndFix(ctx, [], 1);
      approve(state);
      ctx.log(`Approved. Next: brewery barrel ${state.slug}`);
      return "approved";
    }
    // Rejected, or answers without an approval: reshape as needed and ask again.
    const asks = verdict === "reject" || result.structural ? await cutAndFix(ctx, result.ask ?? [], ctx.config.limits.cutRounds) : (result.ask ?? []);
    await sendForSignoff(ctx, asks);
    return "waiting";
  }

  const text = reply.trim().toLowerCase();
  state.waiting = undefined;
  if (text.startsWith("stop")) {
    saveState(state);
    ctx.log(`Stopped. Resume later with: brewery barrel ${state.slug}`);
    return "stopped";
  }
  const task = waiting.task ? state.tasks[waiting.task] : undefined;
  if (task) {
    if (text.startsWith("skip")) task.status = "skipped";
    else task.attempts = 0;
  }
  if (state.phase === "review") {
    if (text.startsWith("ship")) state.phase = "brew";
    else state.reviewRounds = 0;
  }
  saveState(state);
  return "continue";
};
