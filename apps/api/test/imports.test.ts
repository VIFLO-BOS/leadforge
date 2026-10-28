import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { API, createHarness, orgHeaders, runImportToCompletion, type Harness } from "./harness.js";
import { createOwner, csvBuffer, uploadCsv, type OrgUser } from "./fixtures.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h?.close());
beforeEach(async () => h.resetState());

const NAME_PHONE = [
  { column: 0, field: "name" },
  { column: 1, field: "phone" },
];

const MAPPING = [
  { column: 0, field: "name" },
  { column: 1, field: "phone" },
  { column: 2, field: "email" },
  { column: 3, field: "website" },
  { column: 4, field: "locality" },
  { column: 5, field: "region" },
  { column: 6, field: "category" },
];

const GOOD_CSV = [
  "Business Name,Phone,Email,Website,City,State,Category",
  'Acme Foods,0803 123 4567,info@acme-foods.example.test,www.acme-foods.example.test,ikeja,Lagos State,"Restaurant; Catering"',
  "Bola Pharmacy,+234 812 000 1111,,bola-pharmacy.example.test,Yaba,lagos,Pharmacy",
  '"Chi ""Best"" Salon","0805 555 0000","chi@salon.example.test","","Wuse","FCT","Salon"',
  '=HYPERLINK("http://evil.example","x"),0803 000 0000,,,,,',
  "Delta Logistics,12345,ops@delta,,Warri,Delta,Logistics",
  ",0809 111 2222,,,,,",
];

function commit(
  user: OrgUser,
  importId: string,
  mapping: Array<{ column: number; field: string }> = MAPPING,
) {
  return user.agent
    .post(`${API}/imports/${importId}/commit`)
    .set(orgHeaders(user.agent, user.orgId))
    .send({ mapping, defaultCountry: "NG", attestLawfulBasis: true });
}

describe("CSV import end to end", () => {
  it("uploads, previews, commits in the worker, reports every row, then a correction shows in provenance", async () => {
    const owner = await createOwner(h, "importer@example.test", "Import Org");

    // Upload: parsed, staged, suggested mapping.
    const upload = await uploadCsv(owner, csvBuffer(GOOD_CSV)).expect(201);
    const job = upload.body.data;
    expect(job.status).toBe("uploaded");
    expect(job.rowCount).toBe(6);
    expect(job.headers).toEqual([
      "Business Name",
      "Phone",
      "Email",
      "Website",
      "City",
      "State",
      "Category",
    ]);
    expect(job.suggestedMapping).toEqual(MAPPING);
    expect(job.sampleRows[0][0]).toBe("Acme Foods");

    // Preview: per-row validation errors, nothing written.
    const preview = await owner.agent
      .post(`${API}/imports/${job.id}/preview`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ mapping: MAPPING, defaultCountry: "NG" })
      .expect(200);
    const rows = preview.body.data.rows as Array<{
      rowNumber: number;
      valid: boolean;
      expectedOutcome: string;
      errors: Array<{ code: string; column: number | null }>;
      values: { phones: Array<{ e164: string }>; location: { region: string | null } };
    }>;
    expect(preview.body.data.summary).toEqual({ totalRows: 6, checked: 6, valid: 3, invalid: 3 });
    expect(rows[0]).toMatchObject({ rowNumber: 2, valid: true, expectedOutcome: "create" });
    expect(rows[0]!.values.phones[0]!.e164).toBe("+2348031234567");
    expect(rows[0]!.values.location.region).toBe("Lagos");
    expect(rows[2]!.values.location.region).toBe("Federal Capital Territory");
    expect(rows[3]!.errors[0]).toMatchObject({ code: "FORMULA_INJECTION", column: 0 });
    expect(rows[4]!.errors.map((e) => e.code).sort()).toEqual(["INVALID_EMAIL", "INVALID_PHONE"]);
    expect(rows[5]!.errors[0]).toMatchObject({ code: "REQUIRED", column: 0 });
    const before = await owner.agent
      .get(`${API}/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(before.body.data).toHaveLength(0);

    // Commit: 202 queued, enqueued once under a deterministic job id.
    const committed = await commit(owner, job.id).expect(202);
    expect(committed.body.data.status).toBe("queued");
    expect(await h.importQueue.getJob(`import-${job.id}`)).toBeTruthy();
    await commit(owner, job.id).expect(409);
    const latePreview = await owner.agent
      .post(`${API}/imports/${job.id}/preview`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ mapping: MAPPING })
      .expect(409);
    expect(latePreview.body.error.code).toBe("CONFLICT");

    // Worker processes; progress observed by polling like the UI.
    const done = await runImportToCompletion(h, owner.agent, owner.orgId, job.id);
    expect(done.status).toBe("completed_with_errors");
    expect(done.progress).toEqual({
      total: 6,
      processed: 6,
      created: 3,
      updated: 0,
      suppressed: 0,
      failed: 3,
      percent: 100,
    });

    // Every failed row is reported with its spreadsheet row number and reasons.
    const failed = await owner.agent
      .get(`${API}/imports/${job.id}/rows?outcome=failed`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(failed.body.data.map((r: { rowNumber: number }) => r.rowNumber)).toEqual([5, 6, 7]);
    expect(failed.body.data[0].errors[0].code).toBe("FORMULA_INJECTION");

    // Rows appear in the directory with user_import provenance.
    const list = await owner.agent
      .get(`${API}/businesses?sort=name:asc&importId=${job.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(list.body.meta.total).toBe(3);
    expect(list.body.data.map((b: { name: string }) => b.name)).toEqual([
      "Acme Foods",
      "Bola Pharmacy",
      'Chi "Best" Salon',
    ]);
    const acme = list.body.data[0];
    expect(acme.sources).toEqual(["user_import"]);
    expect(acme.states).toMatchObject({
      phone: "unverified",
      email: "unverified",
      website: "unverified",
    });
    expect(acme.whatsapp).toBe("unknown");

    // Detail, then correct the phone.
    const detail = await owner.agent
      .get(`${API}/businesses/${acme.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(
      detail.body.data.provenance.recent.every(
        (o: { source: string; importId: string }) =>
          o.source === "user_import" && o.importId === job.id,
      ),
    ).toBe(true);
    expect(detail.body.data.createdVia).toMatchObject({ kind: "import", importId: job.id });

    const corrected = await owner.agent
      .patch(`${API}/businesses/${acme.id}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({
        field: "phone",
        target: "+2348031234567",
        value: "0809 876 5432",
        note: "Called and confirmed new line",
      })
      .expect(200);
    expect(corrected.body.data.phones.map((p: { e164: string }) => p.e164)).toEqual([
      "+2348098765432",
    ]);
    expect(corrected.body.data.phones[0].state).toBe("unverified");
    const edit = corrected.body.data.provenance.recent[0];
    expect(edit).toMatchObject({
      source: "user_edit",
      collectionMethod: "user_edit",
      field: "phone",
      fieldKey: "+2348098765432",
      normalizedValue: "+2348098765432",
      note: "Called and confirmed new line",
      actor: { type: "user", userId: owner.userId },
    });
    expect(corrected.body.data.phones[0].observationIds).toContain(edit.id);
    expect(corrected.body.data.sources.map((s: { source: string }) => s.source).sort()).toEqual([
      "user_edit",
      "user_import",
    ]);

    const observations = await owner.agent
      .get(`${API}/businesses/${acme.id}/observations?field=phone`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(observations.body.data.map((o: { source: string }) => o.source)).toEqual([
      "user_edit",
      "user_import",
    ]);

    // Audit trail for the import and the correction.
    const audit = await h.app
      .get((await import("@leadforge/db-mongo")).MongoService)
      .database.collection("audit_events")
      .find({ organizationId: owner.orgId })
      .toArray();
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "import.uploaded",
        "import.committed",
        "import.finished",
        "business.corrected",
        "business.contacts_viewed",
      ]),
    );
  });

  it("dedups exactly within the org on identifier plus name and keeps different names apart", async () => {
    const owner = await createOwner(h, "dedup@example.test");
    const first = await uploadCsv(
      owner,
      csvBuffer([
        "Name,Phone,Email,Website,City,State,Category",
        "Acme Foods Ltd,0803 123 4567,,,Ikeja,Lagos,Restaurant",
        "ACME FOODS,0803 123 4567,sales@acme.example.test,,Ikeja,Lagos,Catering",
        "Other Business,0803 123 4567,,,Ikeja,Lagos,Bakery",
      ]),
    ).expect(201);
    await commit(owner, first.body.data.id).expect(202);
    const done = await runImportToCompletion(h, owner.agent, owner.orgId, first.body.data.id);
    expect(done.progress).toMatchObject({ created: 2, updated: 1, failed: 0 });

    const rows = await owner.agent
      .get(`${API}/imports/${first.body.data.id}/rows`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(rows.body.data.map((r: { outcome: string }) => r.outcome)).toEqual([
      "created",
      "updated",
      "created",
    ]);
    expect(rows.body.data[1].businessId).toBe(rows.body.data[0].businessId);
    expect(rows.body.data[2].warnings[0].code).toBe("POSSIBLE_DUPLICATE");

    const merged = await owner.agent
      .get(`${API}/businesses/${rows.body.data[0].businessId}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(merged.body.data.categories.map((c: { value: string }) => c.value)).toEqual([
      "Restaurant",
      "Catering",
    ]);
    expect(merged.body.data.emails.map((e: { address: string }) => e.address)).toEqual([
      "sales@acme.example.test",
    ]);
    expect(merged.body.data.name.observationIds).toHaveLength(2);
  });

  it("skips rows that match a suppression entry and reports them", async () => {
    const owner = await createOwner(h, "supp@example.test");
    const seed = await uploadCsv(
      owner,
      csvBuffer(["Name,Phone", "Quiet Shop,0803 123 4567"]),
    ).expect(201);
    await commit(owner, seed.body.data.id, NAME_PHONE).expect(202);
    await runImportToCompletion(h, owner.agent, owner.orgId, seed.body.data.id);
    const list = await owner.agent
      .get(`${API}/businesses`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    await owner.agent
      .post(`${API}/businesses/${list.body.data[0].id}/suppress`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ scope: "phone", reason: "Owner asked not to be contacted" })
      .expect(200);

    const again = await uploadCsv(
      owner,
      csvBuffer(["Name,Phone", "Different Name,+2348031234567"]),
    ).expect(201);
    await commit(owner, again.body.data.id, NAME_PHONE).expect(202);
    const done = await runImportToCompletion(h, owner.agent, owner.orgId, again.body.data.id);
    expect(done.progress).toMatchObject({ suppressed: 1, created: 0 });
    const rows = await owner.agent
      .get(`${API}/imports/${again.body.data.id}/rows`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(rows.body.data[0]).toMatchObject({ outcome: "suppressed", businessId: null });
    expect(rows.body.data[0].warnings[0].code).toBe("SUPPRESSED");
  });

  it("is idempotent when the same import is processed twice", async () => {
    const owner = await createOwner(h, "idem@example.test");
    const up = await uploadCsv(
      owner,
      csvBuffer(["Name,Phone", "Solo Store,0803 222 3333", "Nameless Corner,"]),
    ).expect(201);
    await commit(owner, up.body.data.id, NAME_PHONE).expect(202);
    await runImportToCompletion(h, owner.agent, owner.orgId, up.body.data.id);

    // Simulate a crash before outcomes were written: clear outcomes and process again.
    const { MongoService } = await import("@leadforge/db-mongo");
    const db = h.app.get(MongoService).database;
    await db.collection("import_rows").updateMany({}, { $set: { outcome: null } });
    await db.collection("import_jobs").updateMany({}, { $set: { status: "processing" } });
    const { ImportsService } = await import("@leadforge/core");
    await h.app.get(ImportsService, { strict: false }).process(owner.orgId, up.body.data.id);

    expect(await db.collection("businesses").countDocuments({ organizationId: owner.orgId })).toBe(
      2,
    );
    const obs = await db
      .collection("source_observations")
      .countDocuments({ organizationId: owner.orgId });
    expect(obs).toBe(3); // two names and one phone, never duplicated
    const rows = await owner.agent
      .get(`${API}/imports/${up.body.data.id}/rows`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(rows.body.data.map((r: { outcome: string }) => r.outcome)).toEqual([
      "created",
      "created",
    ]);
  });
});

describe("upload validation and limits", () => {
  it("rejects missing files, wrong types, binary content and empty files", async () => {
    const owner = await createOwner(h, "limits@example.test");
    const missing = await owner.agent
      .post(`${API}/imports`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(400);
    expect(missing.body.error.code).toBe("VALIDATION_FAILED");

    const pdf = await uploadCsv(
      owner,
      Buffer.from("%PDF-1.7"),
      "list.pdf",
      "application/pdf",
    ).expect(415);
    expect(pdf.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const disguised = await uploadCsv(
      owner,
      Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]),
      "list.csv",
      "text/csv",
    ).expect(415);
    expect(disguised.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(disguised.body.error.message).toMatch(/Excel/);

    const image = await uploadCsv(owner, Buffer.from("Name\nx\n"), "list.csv", "image/png").expect(
      415,
    );
    expect(image.body.error.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    const headerOnly = await uploadCsv(owner, Buffer.from("Name,Phone\n")).expect(422);
    expect(headerOnly.body.error.code).toBe("IMPORT_INVALID");

    const broken = await uploadCsv(
      owner,
      Buffer.from('Name,City\n"Acme,Ikeja\nBeta,Yaba\n'),
    ).expect(422);
    expect(broken.body.error.code).toBe("IMPORT_INVALID");
    expect(broken.body.error.details[0].path).toBe("file");
  });

  it("accepts Windows Excel's CSV MIME type and a BOM", async () => {
    const owner = await createOwner(h, "excel@example.test");
    const res = await uploadCsv(
      owner,
      Buffer.concat([
        Buffer.from([0xef, 0xbb, 0xbf]),
        Buffer.from("Name;Phone\nAcme;0803 123 4567\n"),
      ]),
      "export.csv",
      "application/vnd.ms-excel",
    ).expect(201);
    expect(res.body.data).toMatchObject({
      headers: ["Name", "Phone"],
      delimiter: ";",
      encoding: "utf-8",
    });
  });

  it("returns 413 PAYLOAD_TOO_LARGE above the 20 MB upload cap", async () => {
    const owner = await createOwner(h, "big@example.test");
    const big = Buffer.alloc(20 * 1024 * 1024 + 10, "a");
    const res = await uploadCsv(owner, big).expect(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("validates mappings against the file and returns 404 for unknown imports", async () => {
    const owner = await createOwner(h, "mapping@example.test");
    const up = await uploadCsv(owner, csvBuffer(["Name,Phone", "Acme,0803 123 4567"])).expect(201);
    const outOfRange = await owner.agent
      .post(`${API}/imports/${up.body.data.id}/preview`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({
        mapping: [
          { column: 0, field: "name" },
          { column: 7, field: "phone" },
        ],
      })
      .expect(400);
    expect(outOfRange.body.error.details[0].path).toBe("mapping.1.column");

    const noName = await owner.agent
      .post(`${API}/imports/${up.body.data.id}/preview`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ mapping: [{ column: 1, field: "phone" }] })
      .expect(400);
    expect(noName.body.error.code).toBe("VALIDATION_FAILED");

    const noAttest = await owner.agent
      .post(`${API}/imports/${up.body.data.id}/commit`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .send({ mapping: [{ column: 0, field: "name" }] })
      .expect(400);
    expect(noAttest.body.error.details[0].path).toBe("attestLawfulBasis");

    const missing = await owner.agent
      .get(`${API}/imports/0123456789abcdef01234567`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(404);
    expect(missing.body.error.code).toBe("NOT_FOUND");
    await owner.agent
      .get(`${API}/imports/not-an-id`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(400);
  });

  it("rate limits uploads to 30 per hour per user", async () => {
    const owner = await createOwner(h, "rl-upload@example.test");
    for (let i = 0; i < 30; i++)
      await uploadCsv(owner, csvBuffer(["Name", `Row ${i}`])).expect(201);
    const limited = await uploadCsv(owner, csvBuffer(["Name", "One too many"])).expect(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  it("lists imports newest first with cursor pagination", async () => {
    const owner = await createOwner(h, "list@example.test");
    for (const name of ["a", "b", "c"])
      await uploadCsv(owner, csvBuffer(["Name", name]), `${name}.csv`).expect(201);
    const first = await owner.agent
      .get(`${API}/imports?pageSize=2`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(first.body.data.map((j: { fileName: string }) => j.fileName)).toEqual([
      "c.csv",
      "b.csv",
    ]);
    const second = await owner.agent
      .get(`${API}/imports?pageSize=2&cursor=${first.body.meta.nextCursor}`)
      .set(orgHeaders(owner.agent, owner.orgId))
      .expect(200);
    expect(second.body.data.map((j: { fileName: string }) => j.fileName)).toEqual(["a.csv"]);
    expect(second.body.meta.nextCursor).toBeNull();
  });
});
