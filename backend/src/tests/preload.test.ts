import {expect, test} from "bun:test";
import mongoose from "mongoose";
import {triviaConnection} from "../models/triviaQuestion";

test("import-time trivia connection uses the test Mongo server", async () => {
  await triviaConnection.asPromise();
  expect(triviaConnection.host).toBe(mongoose.connection.host);
  expect(triviaConnection.port).toBe(mongoose.connection.port);
  expect(triviaConnection.name).toBe(mongoose.connection.name);
  expect(await triviaConnection.db!.command({ping: 1})).toMatchObject({ok: 1});
}, 10000);
