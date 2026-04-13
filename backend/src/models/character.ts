import mongoose from "mongoose";
import type {CharacterDocument, CharacterModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const characterSchema = new mongoose.Schema<CharacterDocument, CharacterModel>(
  {
    movieId: {type: mongoose.Schema.Types.ObjectId, ref: "Movie", required: true, index: true},
    name: {type: String, required: true},
    actorName: {type: String},
    appearances: [
      {
        frameId: {type: mongoose.Schema.Types.ObjectId, ref: "Frame"},
        timestamp: {type: Number},
        description: {type: String, default: ""},
      },
    ],
    firstSeen: {type: Number, default: 0},
    lastSeen: {type: Number, default: 0},
    totalAppearances: {type: Number, default: 0},
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

characterSchema.index({movieId: 1, name: 1});

addDefaultPlugins(characterSchema);

export const Character = mongoose.model<CharacterDocument, CharacterModel>(
  "Character",
  characterSchema
);
