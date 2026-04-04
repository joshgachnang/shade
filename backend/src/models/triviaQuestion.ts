import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {TriviaQuestionDocument, TriviaQuestionModel} from "../types";

const triviaConnection = mongoose.createConnection(
  process.env.TRIVIA_MONGO_URI || "mongodb://localhost:27017/trivia"
);

const triviaQuestionSchema = new mongoose.Schema<TriviaQuestionDocument, TriviaQuestionModel>(
  {
    year: {type: Number, required: true, index: true},
    hour: {type: Number, required: true, min: 1, max: 54},
    questionNumber: {type: Number, required: true, min: 1, max: 12},
    questionText: {type: String, required: true},
    answer: {type: String, default: ""},
    reasoning: {type: String, default: ""},
    rawExcerpts: {type: [String], default: []},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

triviaQuestionSchema.index({year: 1, hour: 1, questionNumber: 1}, {unique: true});

triviaQuestionSchema.plugin(createdUpdatedPlugin);
triviaQuestionSchema.plugin(isDeletedPlugin);
triviaQuestionSchema.plugin(findOneOrNone);
triviaQuestionSchema.plugin(findExactlyOne);

export const TriviaQuestion = triviaConnection.model<TriviaQuestionDocument, TriviaQuestionModel>(
  "TriviaQuestion",
  triviaQuestionSchema
);

export {triviaConnection};
