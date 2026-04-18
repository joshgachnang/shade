import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "./userTypes";

export interface CharacterAppearance {
  frameId: mongoose.Types.ObjectId;
  timestamp: number;
  description: string;
}

export interface CharacterFields {
  movieId: mongoose.Types.ObjectId;
  name: string;
  actorName?: string;
  appearances: CharacterAppearance[];
  firstSeen: number;
  lastSeen: number;
  totalAppearances: number;
}

export type CharacterDocument = DefaultDoc & CharacterFields;
export type CharacterStatics = DefaultStatics<CharacterDocument>;
export type CharacterModel = DefaultModel<CharacterDocument> & CharacterStatics;
export type CharacterSchema = mongoose.Schema<CharacterDocument, CharacterModel>;
