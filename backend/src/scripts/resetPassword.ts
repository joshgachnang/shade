import mongoose from "mongoose";
import {User} from "../models/user";

const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error("Usage: bun run src/scripts/resetPassword.ts <email> <password>");
  process.exit(1);
}

const mongoURI = process.env.MONGO_URI || "mongodb://localhost:27017/shade";

const run = async () => {
  await mongoose.connect(mongoURI);
  const user = await User.findByEmail(email);
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }
  await user.setPassword(newPassword);
  await user.save();
  console.info(`Password reset for ${email}`);
  await mongoose.disconnect();
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
