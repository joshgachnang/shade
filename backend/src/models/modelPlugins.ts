import {
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  isDeletedPlugin,
} from "@terreno/api";
import type mongoose from "mongoose";

// biome-ignore lint/suspicious/noExplicitAny: Leaving open for flexibility
export function addDefaultPlugins(schema: mongoose.Schema<any, any, any, any>): void {
  schema.plugin(createdUpdatedPlugin);
  schema.plugin(isDeletedPlugin);
  schema.plugin(findOneOrNone);
  schema.plugin(findExactlyOne);
}
