import {randomUUID} from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {logger} from "@terreno/api";
import {config} from "../config";
import {AgentSession} from "../models/agentSession";
import type {AgentSessionDocument} from "../types";

export const getSessionDir = (groupId: string): string => {
  return path.join(config.paths.sessions, groupId);
};

export const getTranscriptPath = (groupId: string, sessionId: string): string => {
  return path.join(getSessionDir(groupId), `${sessionId}.jsonl`);
};

export const createSession = async (groupId: string): Promise<AgentSessionDocument> => {
  const sessionId = randomUUID();
  const sessionDir = getSessionDir(groupId);

  try {
    await fs.mkdir(sessionDir, {recursive: true});
  } catch (err) {
    logger.error(`Failed to create session directory ${sessionDir}: ${err}`);
    throw err;
  }

  const transcriptPath = getTranscriptPath(groupId, sessionId);

  const session = await AgentSession.create({
    groupId,
    sessionId,
    transcriptPath,
    status: "active",
    messageCount: 0,
    lastActivityAt: new Date(),
  });

  logger.info(`Created session ${sessionId} for group ${groupId}`);
  return session;
};

export const resumeSession = async (groupId: string): Promise<AgentSessionDocument | null> => {
  const session = await AgentSession.findOne({
    groupId,
    status: "active",
  }).sort({lastActivityAt: -1});

  if (!session) {
    logger.debug(`No active session found for group ${groupId}`);
    return null;
  }

  logger.info(`Resuming session ${session.sessionId} for group ${groupId}`);
  return session;
};

export const getOrCreateSession = async (groupId: string): Promise<AgentSessionDocument> => {
  const existing = await resumeSession(groupId);
  if (existing) {
    return existing;
  }
  return createSession(groupId);
};

export const updateSessionActivity = async (
  sessionId: string,
  incrementMessages = 1
): Promise<void> => {
  try {
    await AgentSession.findOneAndUpdate(
      {sessionId},
      {
        $inc: {messageCount: incrementMessages},
        $set: {lastActivityAt: new Date()},
      }
    );
    logger.debug(`Session ${sessionId} activity updated (+${incrementMessages} messages)`);
  } catch (err) {
    logger.error(`Failed to update session activity for ${sessionId}: ${err}`);
    throw err;
  }
};

export const updateResumeCheckpoint = async (
  sessionId: string,
  resumeSessionAt: string
): Promise<void> => {
  try {
    await AgentSession.findOneAndUpdate(
      {sessionId},
      {$set: {resumeSessionAt, lastActivityAt: new Date()}}
    );
    logger.info(`Session ${sessionId} resume checkpoint saved: ${resumeSessionAt}`);
  } catch (err) {
    logger.error(`Failed to save resume checkpoint for ${sessionId}: ${err}`);
    throw err;
  }
};

export const closeSession = async (sessionId: string): Promise<void> => {
  try {
    await AgentSession.findOneAndUpdate(
      {sessionId},
      {$set: {status: "closed", lastActivityAt: new Date()}}
    );
    logger.info(`Closed session ${sessionId}`);
  } catch (err) {
    logger.error(`Failed to close session ${sessionId}: ${err}`);
    throw err;
  }
};

export const appendToTranscript = async (
  transcriptPath: string,
  entry: Record<string, unknown>
): Promise<void> => {
  try {
    const line = `${JSON.stringify({...entry, timestamp: new Date().toISOString()})}\n`;
    await fs.appendFile(transcriptPath, line, "utf-8");
    logger.debug(`Transcript appended: ${transcriptPath} (${line.length} chars)`);
  } catch (err) {
    logger.error(`Failed to append to transcript ${transcriptPath}: ${err}`);
    throw err;
  }
};

export const readTranscript = async (
  transcriptPath: string
): Promise<Record<string, unknown>[]> => {
  try {
    const content = await fs.readFile(transcriptPath, "utf-8");
    const entries = content
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    logger.debug(`Read ${entries.length} transcript entries from ${transcriptPath}`);
    return entries;
  } catch {
    logger.debug(`Transcript not found or empty: ${transcriptPath}`);
    return [];
  }
};
