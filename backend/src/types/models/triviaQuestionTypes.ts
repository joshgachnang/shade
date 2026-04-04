import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface TriviaQuestionFields {
  year: number;
  hour: number;
  questionNumber: number;
  questionText: string;
  answer: string;
  reasoning: string;
  rawExcerpts: string[];
}

export type TriviaQuestionDocument = DefaultDoc & TriviaQuestionFields;
export type TriviaQuestionStatics = DefaultStatics<TriviaQuestionDocument>;
export type TriviaQuestionModel = DefaultModel<TriviaQuestionDocument> & TriviaQuestionStatics;
export type TriviaQuestionSchema = mongoose.Schema<TriviaQuestionDocument, TriviaQuestionModel>;
