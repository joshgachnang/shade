import mongoose from "mongoose";
import passportLocalMongooseImport from "passport-local-mongoose";
import type {UserDocument, UserModel} from "../types";
import {addDefaultPlugins} from "./modelPlugins";

const userSchema = new mongoose.Schema<UserDocument, UserModel>(
  {
    admin: {
      default: false,
      type: Boolean,
    },
    email: {
      lowercase: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    name: {
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// When bundled (bun build), this CJS default import resolves to a namespace
// object with the plugin at `.default`; unbundled it is the plugin function.
const passportLocalMongoose =
  typeof passportLocalMongooseImport === "function"
    ? passportLocalMongooseImport
    : (passportLocalMongooseImport as unknown as {default: typeof passportLocalMongooseImport})
        .default;

userSchema.plugin(passportLocalMongoose, {
  usernameField: "email",
});

addDefaultPlugins(userSchema);

userSchema.method("getDisplayName", function (this: UserDocument): string {
  return this.name;
});

export const User = mongoose.model<UserDocument, UserModel>("User", userSchema);

User.findByEmail = async function (email: string): Promise<UserDocument | null> {
  return this.findOneOrNone({email: email.toLowerCase()});
};
