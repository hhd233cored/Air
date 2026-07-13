import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle",
  schema: "./backend/db/schema.ts",
  dialect: "sqlite",
});
