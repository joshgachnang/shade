import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface TriviaScoreFields {
  year: number;
  hour: number;
  place: number;
  teamName: string;
  score: number;
  scrapedAt: Date;
}

export type TriviaScoreDocument = DefaultDoc & TriviaScoreFields;
export type TriviaScoreStatics = DefaultStatics<TriviaScoreDocument>;
export type TriviaScoreModel = DefaultModel<TriviaScoreDocument> & TriviaScoreStatics;
export type TriviaScoreSchema = mongoose.Schema<TriviaScoreDocument, TriviaScoreModel>;
