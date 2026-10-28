import {
  Injectable,
  StreamableFile,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";
import type { PageMeta } from "@leadforge/contracts";

/** Return this from a handler to emit { data, meta } for lists. */
export class Paged<T> {
  constructor(
    readonly data: T[],
    readonly meta: PageMeta,
  ) {}
}

export function paged<T>(data: T[], meta: Partial<PageMeta> = {}): Paged<T> {
  return new Paged(data, { nextCursor: null, pageSize: data.length, ...meta });
}

/** Wraps every successful response in the { data } envelope (file downloads pass through). */
@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((value: unknown) => {
        if (value instanceof StreamableFile) return value;
        if (value instanceof Paged) return { data: value.data, meta: value.meta };
        if (value === undefined) return { data: null };
        return { data: value };
      }),
    );
  }
}
