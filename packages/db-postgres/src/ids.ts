import { v7 as uuidv7 } from "uuid";

/** Time-ordered UUID for all PostgreSQL-owned entities. */
export function newId(): string {
  return uuidv7();
}
