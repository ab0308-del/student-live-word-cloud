import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  question: text("question").notNull(),
  isOpen: integer("is_open", { mode: "boolean" }).notNull().default(true),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const responses = sqliteTable("responses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentName: text("student_name"),
  answer: text("answer").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
