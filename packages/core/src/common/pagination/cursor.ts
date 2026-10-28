import { InvalidCursorError } from "@leadforge/db-mongo";
import { AppError } from "../errors/app.error.js";

/** Runs a paged query and turns a bad cursor into VALIDATION_FAILED on `cursor`. */
export async function withCursor<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      throw AppError.validation([
        { path: "cursor", message: "Invalid or expired cursor; start from the first page" },
      ]);
    }
    throw err;
  }
}
