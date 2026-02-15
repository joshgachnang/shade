import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import type mongoose from "mongoose";

export function addDefaultPlugins(schema: mongoose.Schema<any, any, any, any>): void {
  schema.plugin(createdUpdatedPlugin);
  schema.plugin(isDeletedPlugin);
  schema.plugin(findOneOrNone);
  schema.plugin(findExactlyOne);
}
