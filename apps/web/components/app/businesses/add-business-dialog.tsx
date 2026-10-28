"use client";

import { CreateBusinessRequest } from "@leadforge/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import {
  Banner,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  TextAreaField,
  TextField,
  toast,
} from "@leadforge/ui";
import { useWorkspace } from "@/components/app/app-shell";
import { isApiError } from "@/lib/api";
import { friendlyMessage, requestIdOf } from "@/lib/errors";
import { applyServerErrors, schemaResolver, splitList, type PathSegment } from "@/lib/forms";
import { useCreateBusiness } from "@/lib/hooks/use-businesses";

export interface AddBusinessForm {
  name: string;
  categories: string;
  website: string;
  phones: string;
  emails: string;
  street: string;
  locality: string;
  lga: string;
  region: string;
  country: string;
  postalCode: string;
  note: string;
}

const LOCATION_FIELDS = ["street", "locality", "lga", "region", "postalCode"] as const;

const EMPTY: AddBusinessForm = {
  name: "",
  categories: "",
  website: "",
  phones: "",
  emails: "",
  street: "",
  locality: "",
  lga: "",
  region: "",
  country: "",
  postalCode: "",
  note: "",
};

/** Form values to the contracts' CreateBusinessRequest body. */
export function toCreateRequest(values: AddBusinessForm): Record<string, unknown> {
  const country = values.country.trim().toUpperCase();
  const location: Record<string, string> = {};
  for (const key of LOCATION_FIELDS) {
    const v = values[key].trim();
    if (v) location[key] = v;
  }
  const body: Record<string, unknown> = {
    name: values.name,
    categories: splitList(values.categories),
    phones: splitList(values.phones),
    emails: splitList(values.emails),
  };
  if (values.website.trim()) body.website = values.website.trim();
  if (country) body.country = country;
  if (Object.keys(location).length)
    body.location = { ...location, ...(country ? { country } : {}) };
  if (values.note.trim()) body.note = values.note.trim();
  return body;
}

const ITEM_NOUN: Record<string, string> = {
  categories: "Category",
  phones: "Phone",
  emails: "Email",
};

/** Maps a schema or API detail path ("phones.1", "location.region") to a form field. */
export function formFieldFor(path: PathSegment[]): {
  field: keyof AddBusinessForm;
  prefix: string;
} {
  const [head, second] = path;
  if (head === "location" && typeof second === "string") {
    const field = (
      second === "country"
        ? "country"
        : LOCATION_FIELDS.includes(second as never)
          ? second
          : "street"
    ) as keyof AddBusinessForm;
    return { field, prefix: "" };
  }
  if (head === "categories" || head === "phones" || head === "emails") {
    return {
      field: head,
      prefix: typeof second === "number" ? `${ITEM_NOUN[head]} ${second + 1}: ` : "",
    };
  }
  if (typeof head === "string" && head in EMPTY)
    return { field: head as keyof AddBusinessForm, prefix: "" };
  return { field: "name", prefix: "" };
}

/** Validates with the contracts schema the API uses, reporting issues on the matching inputs. */
const resolver = schemaResolver<AddBusinessForm>(
  CreateBusinessRequest,
  toCreateRequest,
  formFieldFor,
);

export interface AddBusinessDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Manual "Add business" (POST /businesses). Values are normalized server-side like import rows. */
export function AddBusinessDialog({ open, onOpenChange }: AddBusinessDialogProps) {
  const { org } = useWorkspace();
  const router = useRouter();
  const create = useCreateBusiness();
  const form = useForm<AddBusinessForm>({
    resolver,
    defaultValues: { ...EMPTY, country: org.country ?? "NG" },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (!open) {
      form.reset({ ...EMPTY, country: org.country ?? "NG" });
      create.reset();
    }
    // form and create are stable; reset only when the dialog closes.
  }, [open, org.country]);

  const submit = form.handleSubmit(async (values) => {
    try {
      const detail = await create.mutateAsync(CreateBusinessRequest.parse(toCreateRequest(values)));
      toast.success("Business added", { description: detail.name.value ?? undefined });
      onOpenChange(false);
      router.push(`/app/businesses/${detail.id}`);
    } catch (err) {
      applyServerErrors(form, err, formFieldFor);
    }
  });

  const conflictId =
    isApiError(create.error) && create.error.code === "CONFLICT"
      ? create.error.details?.find((d) => d.path === "existingBusinessId")?.message
      : undefined;
  const genericError =
    create.error &&
    !(
      isApiError(create.error) &&
      (create.error.code === "VALIDATION_FAILED" || create.error.code === "CONFLICT")
    )
      ? create.error
      : null;

  const field = (name: keyof AddBusinessForm) => ({
    ...form.register(name),
    error: errors[name]?.message,
  });

  return (
    <Dialog open={open} onOpenChange={(o) => (isSubmitting ? undefined : onOpenChange(o))}>
      <DialogContent size="lg">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Add a business</DialogTitle>
            <DialogDescription>
              Phones, emails and the website are normalized and checked like imported rows. The
              entry is recorded as a manual observation in the business&apos;s provenance.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
            <TextField
              id="add-name"
              label="Business name"
              required
              autoComplete="off"
              {...field("name")}
            />
            <TextField
              id="add-categories"
              label="Categories"
              hint="Separate with commas, for example Bakery, Catering. Up to 10."
              autoComplete="off"
              {...field("categories")}
            />
            <TextField
              id="add-website"
              label="Website"
              inputMode="url"
              autoComplete="off"
              hint="Domain or full address. Social profile links are not accepted here."
              {...field("website")}
            />
            <div className="grid min-w-0 grid-cols-1 gap-5 min-[640px]:grid-cols-2">
              <TextAreaField
                id="add-phones"
                label="Phone numbers"
                hint="One per line. Numbers without a country code use the country below."
                className="min-h-[96px]"
                {...field("phones")}
              />
              <TextAreaField
                id="add-emails"
                label="Email addresses"
                hint="One per line."
                className="min-h-[96px]"
                {...field("emails")}
              />
            </div>
            <fieldset className="flex min-w-0 flex-col gap-4">
              <legend className="text-foreground mb-3 text-sm font-medium">
                Location (optional)
              </legend>
              <TextField
                id="add-street"
                label="Street address"
                autoComplete="off"
                {...field("street")}
              />
              <div className="grid min-w-0 grid-cols-1 gap-4 min-[480px]:grid-cols-2">
                <TextField
                  id="add-locality"
                  label="City or town"
                  autoComplete="off"
                  {...field("locality")}
                />
                <TextField id="add-lga" label="LGA" autoComplete="off" {...field("lga")} />
                <TextField
                  id="add-region"
                  label="State or region"
                  autoComplete="off"
                  {...field("region")}
                />
                <TextField
                  id="add-postal"
                  label="Postal code"
                  autoComplete="off"
                  {...field("postalCode")}
                />
              </div>
              <TextField
                id="add-country"
                label="Country"
                maxLength={2}
                autoComplete="off"
                hint="Two-letter code, for example NG. Also used to read phone numbers without a country code."
                {...field("country")}
              />
            </fieldset>
            <TextAreaField
              id="add-note"
              label="Note"
              hint="Optional. Saved with the provenance record, for example where you found the details."
              maxLength={500}
              className="min-h-[88px]"
              {...field("note")}
            />
            {conflictId ? (
              <Banner
                tone="warning"
                title="This business already exists"
                description="A business with the same name shares a website, phone or email with this one, or one of the identifiers is suppressed."
                actions={
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/app/businesses/${conflictId}`}>Open the existing business</Link>
                  </Button>
                }
              />
            ) : isApiError(create.error) && create.error.code === "CONFLICT" ? (
              <Banner
                tone="warning"
                title="Could not add this business"
                description={create.error.message}
              />
            ) : null}
            {genericError ? (
              <ErrorState
                title="Could not add the business"
                message={friendlyMessage(genericError)}
                requestId={requestIdOf(genericError)}
              />
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="text"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting}>
              Add business
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
