import {
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBody,
  ApiConsumes,
  ApiCookieAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import type { Request } from "express";
import {
  IMPORT_LIMITS,
  ImportCommitRequest,
  ImportJob,
  ImportListQuery,
  ImportPreviewRequest,
  ImportPreviewResponse,
  ImportRowResult,
  ImportRowsQuery,
  ObjectIdString,
} from "@leadforge/contracts";
import {
  ApiZodBody,
  ApiZodQuery,
  ApiZodResponse,
  AppError,
  AuditService,
  CurrentOrg,
  CurrentUser,
  ImportsService,
  RequirePermission,
  THROTTLE_IMPORT_UPLOADS,
  ZodBody,
  ZodParam,
  ZodQuery,
  type AuthenticatedUser,
  type OrganizationScope,
  PausedDuringDeletionGrace,
} from "@leadforge/core";
import { paged } from "../common/envelope.interceptor.js";

// Type-only aliases keep Zod schemas out of Swagger's query-parameter expansion.
type ListQuery = ImportListQuery;
type RowsQuery = ImportRowsQuery;

/** The subset of the multer file object this controller uses. */
interface MulterFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@ApiTags("imports")
@ApiCookieAuth()
@ApiHeader({
  name: "X-Organization-Id",
  required: true,
  description: "Organization scope; membership is verified server-side",
})
@Controller("imports")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post()
  @RequirePermission("businesses:write")
  @PausedDuringDeletionGrace()
  @HttpCode(201)
  @Throttle(THROTTLE_IMPORT_UPLOADS)
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: IMPORT_LIMITS.maxFileBytes,
        files: 1,
        fields: 5,
        parts: 6,
        headerPairs: 50,
      },
    }),
  )
  @ApiOperation({
    summary: "Upload a CSV (multipart field `file`)",
    description:
      "Max 20 MB, 50,000 data rows, 100 columns, 2,000 characters per cell. UTF-8 (with or without BOM), UTF-16 with BOM or Windows-1252; comma, semicolon or tab separated. Returns the staged import with headers, sample rows and a suggested mapping.",
  })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: { file: { type: "string", format: "binary" } },
    },
  })
  @ApiZodResponse(201, ImportJob)
  upload(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: MulterFile | undefined,
    @Req() req: Request,
  ) {
    if (!file)
      throw AppError.validation([
        { path: "file", message: 'Attach a CSV file in the multipart field "file"' },
      ]);
    return this.imports.upload(
      org.organizationId,
      user.id,
      {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        buffer: file.buffer,
      },
      AuditService.contextFrom(req),
    );
  }

  @Get()
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Imports, newest first" })
  @ApiZodQuery(ImportListQuery)
  @ApiZodResponse(200, ImportJob.array())
  async list(@CurrentOrg() org: OrganizationScope, @ZodQuery(ImportListQuery) query: ListQuery) {
    const page = await this.imports.list(org.organizationId, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }

  @Get(":id")
  @RequirePermission("businesses:read")
  @ApiOperation({ summary: "Import status and progress (poll while queued or processing)" })
  @ApiZodResponse(200, ImportJob)
  get(@CurrentOrg() org: OrganizationScope, @ZodParam("id", ObjectIdString) id: string) {
    return this.imports.get(org.organizationId, id);
  }

  @Post(":id/preview")
  @RequirePermission("businesses:write")
  @HttpCode(200)
  @ApiOperation({
    summary: "Validate the first rows with a mapping",
    description:
      "Normalizes up to `limit` rows and predicts create, update or suppressed against current data. Saves the mapping as a draft. Nothing is written to businesses.",
  })
  @ApiZodBody(ImportPreviewRequest)
  @ApiZodResponse(200, ImportPreviewResponse)
  preview(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(ImportPreviewRequest) body: ImportPreviewRequest,
  ) {
    return this.imports.preview(org.organizationId, id, body);
  }

  @Post(":id/commit")
  @RequirePermission("businesses:write")
  @PausedDuringDeletionGrace()
  @HttpCode(202)
  @ApiOperation({
    summary: "Commit the import (queued to the worker)",
    description:
      "Requires `attestLawfulBasis: true`. Returns 202 with status `queued`; poll GET /imports/:id for progress. 409 if already committed.",
  })
  @ApiZodBody(ImportCommitRequest)
  @ApiZodResponse(202, ImportJob)
  commit(
    @CurrentOrg() org: OrganizationScope,
    @CurrentUser() user: AuthenticatedUser,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodBody(ImportCommitRequest) body: ImportCommitRequest,
    @Req() req: Request,
  ) {
    return this.imports.commit(
      org.organizationId,
      user.id,
      id,
      body,
      AuditService.contextFrom(req),
    );
  }

  @Get(":id/rows")
  @RequirePermission("businesses:read")
  @ApiOperation({
    summary: "Per-row results in file order (filter by outcome, e.g. outcome=failed)",
  })
  @ApiZodQuery(ImportRowsQuery)
  @ApiZodResponse(200, ImportRowResult.array())
  async rows(
    @CurrentOrg() org: OrganizationScope,
    @ZodParam("id", ObjectIdString) id: string,
    @ZodQuery(ImportRowsQuery) query: RowsQuery,
  ) {
    const page = await this.imports.listRows(org.organizationId, id, query);
    return paged(page.items, { nextCursor: page.nextCursor, pageSize: query.pageSize });
  }
}
