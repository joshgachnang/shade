import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {TriviaScoreDocument, TriviaScoreModel} from "../types";
import {triviaConnection} from "./triviaQuestion";

const triviaScoreSchema = new mongoose.Schema<TriviaScoreDocument, TriviaScoreModel>(
  {
    year: {type: Number, required: true, index: true},
    hour: {type: Number, required: true, min: 0, max: 54},
    place: {type: Number, required: true, min: 1},
    teamName: {type: String, required: true},
    score: {type: Number, required: true, min: 0},
    scrapedAt: {type: Date, required: true, default: Date.now},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

triviaScoreSchema.index({year: 1, hour: 1, teamName: 1}, {unique: true});
triviaScoreSchema.index({year: 1, hour: 1, place: 1});

triviaScoreSchema.plugin(createdUpdatedPlugin);
triviaScoreSchema.plugin(isDeletedPlugin);
triviaScoreSchema.plugin(findOneOrNone);
triviaScoreSchema.plugin(findExactlyOne);

export const TriviaScore = triviaConnection.model<TriviaScoreDocument, TriviaScoreModel>(
  "TriviaScore",
  triviaScoreSchema
);
