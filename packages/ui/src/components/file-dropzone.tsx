"use client";

import * as React from "react";
import { FileUp } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "./button";

export interface FileDropzoneProps {
  /** Called with the chosen file. Validate size and type in the caller and show the error. */
  onFile: (file: File) => void;
  /** `accept` attribute for the file picker, for example ".csv,.tsv,.txt". */
  accept?: string;
  title?: React.ReactNode;
  description?: React.ReactNode;
  buttonLabel?: string;
  disabled?: boolean;
  /** Error message shown under the zone (wired with aria-describedby). */
  error?: string | null;
  className?: string;
  id?: string;
}

/**
 * Drop zone plus a real "Choose file" button (the keyboard and screen-reader path). Dragging a
 * file over the zone tints it; dropping hands the first file to `onFile`.
 */
export function FileDropzone({
  onFile,
  accept,
  title = "Drag a file here",
  description,
  buttonLabel = "Choose file",
  disabled,
  error,
  className,
  id,
}: FileDropzoneProps) {
  const autoId = React.useId();
  const inputId = id ?? autoId;
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const depth = React.useRef(0);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div
        data-dragging={over || undefined}
        aria-disabled={disabled || undefined}
        onDragEnter={(e) => {
          if (disabled) return;
          e.preventDefault();
          depth.current += 1;
          setOver(true);
        }}
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (depth.current === 0) setOver(false);
        }}
        onDrop={(e) => {
          if (disabled) return;
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          pick(e.dataTransfer.files);
        }}
        className={cn(
          "transition-ui flex min-w-0 flex-col items-center gap-3 rounded-lg border-2 border-dashed px-4 py-8 text-center sm:py-10",
          over
            ? "border-primary bg-primary-subtle"
            : error
              ? "border-destructive bg-surface-container-low"
              : "border-input bg-surface-container-low",
          disabled && "opacity-[0.38]",
        )}
      >
        <span
          className={cn(
            "transition-ui flex size-12 items-center justify-center rounded-full",
            over
              ? "bg-primary text-primary-foreground scale-110 motion-reduce:scale-100"
              : "bg-primary-container text-primary-container-foreground",
          )}
        >
          <FileUp aria-hidden className="size-6" />
        </span>
        <div className="flex max-w-md flex-col gap-1">
          <p className="text-sm font-medium">{title}</p>
          {description ? <div className="text-muted-foreground text-xs">{description}</div> : null}
        </div>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          disabled={disabled}
          onChange={(e) => {
            pick(e.target.files);
            // Allow choosing the same file again after an error.
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          aria-describedby={error ? `${inputId}-error` : undefined}
          onClick={() => inputRef.current?.click()}
        >
          {buttonLabel}
        </Button>
      </div>
      {error ? (
        <p id={`${inputId}-error`} role="alert" className="text-destructive text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
