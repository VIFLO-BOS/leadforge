import { describe, expect, it, vi } from "vitest";
import type { Job } from "bullmq";
import type { Logger } from "nestjs-pino";
import type { CommitImportJob, ImportsService } from "@leadforge/core";
import { ImportProcessor } from "./import.processor.js";

const ORG = "0192c9a8-0000-7000-8000-000000000001";
const IMPORT = "6add8b76520012303c641f9f";

function setup(process: ImportsService["process"]) {
  const imports = { process: vi.fn(process), markFailed: vi.fn(async () => undefined) };
  const logger = { log: vi.fn(), error: vi.fn() } as unknown as Logger;
  return { imports, processor: new ImportProcessor(imports as unknown as ImportsService, logger) };
}

function job(
  data: Partial<CommitImportJob>,
  attemptsMade = 0,
  attempts = 3,
  name = "commit-import",
) {
  return {
    id: `import-${IMPORT}`,
    name,
    data: { organizationId: ORG, importId: IMPORT, requestedByUserId: ORG, ...data },
    attemptsMade,
    opts: { attempts },
  } as unknown as Job<CommitImportJob>;
}

describe("ImportProcessor", () => {
  it("processes a commit-import job", async () => {
    const { imports, processor } = setup(async () => ({ status: "completed" }));
    await expect(processor.process(job({}))).resolves.toEqual({ status: "completed" });
    expect(imports.process).toHaveBeenCalledWith(ORG, IMPORT);
  });

  it("rejects malformed payloads and unknown job names before touching data", async () => {
    const { imports, processor } = setup(async () => ({ status: "completed" }));
    await expect(processor.process(job({ organizationId: "not-a-uuid" }))).rejects.toThrow(
      /Invalid/,
    );
    await expect(processor.process(job({ importId: '{"$ne":null}' }))).rejects.toThrow(/Invalid/);
    await expect(processor.process(job({}, 0, 3, "drop-everything"))).rejects.toThrow(/Unknown/);
    expect(imports.process).not.toHaveBeenCalled();
  });

  it("lets BullMQ retry earlier attempts and marks the import failed after the last one", async () => {
    const { imports, processor } = setup(async () => {
      throw new Error("mongo unavailable");
    });
    await expect(processor.process(job({}, 0, 3))).rejects.toThrow(/mongo unavailable/);
    expect(imports.markFailed).not.toHaveBeenCalled();
    await expect(processor.process(job({}, 2, 3))).rejects.toThrow(/mongo unavailable/);
    expect(imports.markFailed).toHaveBeenCalledWith(
      ORG,
      IMPORT,
      "PROCESSING_FAILED",
      expect.any(String),
    );
  });
});
