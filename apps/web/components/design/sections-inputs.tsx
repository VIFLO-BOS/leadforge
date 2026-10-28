"use client";

import Link from "next/link";
import { ArrowRight, Download, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Checkbox,
  ChoiceField,
  Chip,
  Combobox,
  FormField,
  Input,
  Label,
  MultiCombobox,
  RadioGroup,
  RadioGroupItem,
  SearchField,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  TextAreaField,
  TextField,
  Textarea,
} from "@leadforge/ui";
import { CITY_OPTIONS, INDUSTRY_OPTIONS } from "./sample-data";
import { Demo, GallerySection } from "./section";

export function ButtonsSection() {
  const [loading, setLoading] = useState(false);
  return (
    <GallerySection
      id="buttons"
      title="Buttons"
      description="Pill buttons with a state layer and a 0.97 press scale on emphasized easing. One filled button per region."
    >
      <Demo label="Variants">
        <Button>Filled</Button>
        <Button variant="tonal">Tonal</Button>
        <Button variant="outline">Outlined</Button>
        <Button variant="text">Text</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">
          <Trash2 aria-hidden /> Delete
        </Button>
        <Button variant="link">Link</Button>
      </Demo>
      <Demo label="Sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
        <Button size="xl">
          Get started <ArrowRight aria-hidden />
        </Button>
      </Demo>
      <Demo label="Icon buttons">
        <Button size="icon-sm" variant="ghost" aria-label="Search (small)">
          <Search aria-hidden />
        </Button>
        <Button size="icon" variant="tonal" aria-label="Add">
          <Plus aria-hidden />
        </Button>
        <Button size="icon-lg" aria-label="Generate">
          <Sparkles aria-hidden />
        </Button>
      </Demo>
      <Demo label="States">
        <Button
          loading={loading}
          onClick={() => {
            setLoading(true);
            window.setTimeout(() => setLoading(false), 1500);
          }}
        >
          <Download aria-hidden /> Export CSV
        </Button>
        <Button disabled>Disabled</Button>
        <Button variant="outline" disabled>
          Disabled outlined
        </Button>
        <Button asChild variant="tonal">
          <Link href="#buttons">Link as button (asChild)</Link>
        </Button>
      </Demo>
    </GallerySection>
  );
}

export function FieldsSection() {
  const [search, setSearch] = useState("");
  return (
    <GallerySection
      id="fields"
      title="Text fields"
      description="Outlined fields. TextField floats its label into the outline; FormField stacks a label above dense controls."
    >
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <TextField id="g-name" label="Business name" hint="As it appears on signage." />
        <TextField
          id="g-email"
          label="Email"
          type="email"
          defaultValue="hello@adunni-bakery.example"
        />
        <TextField
          id="g-password"
          label="Password"
          type="password"
          revealable
          defaultValue="sample-password"
          autoComplete="off"
        />
        <TextField
          id="g-error"
          label="Website"
          defaultValue="not a url"
          error="Enter a full URL, for example https://example.com."
        />
        <TextField id="g-disabled" label="Organization ID" defaultValue="org_sample_123" disabled />
        <TextField id="g-required" label="City" required leading={<Search aria-hidden />} />
        <TextAreaField
          id="g-notes"
          label="Notes"
          hint="Visible to your team only."
          containerClassName="md:col-span-2"
        />
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-3">
        <FormField id="g-input" label="Input (dense)" hint="40px tall for filters and tables.">
          <Input id="g-input" placeholder="Search records" />
        </FormField>
        <FormField id="g-input-invalid" label="Input invalid" error="This field is required.">
          <Input id="g-input-invalid" invalid />
        </FormField>
        <FormField id="g-textarea" label="Textarea">
          <Textarea id="g-textarea" rows={3} />
        </FormField>
      </div>
      <Demo label="SearchField (debounced 300ms)" className="flex-col items-stretch">
        <SearchField
          onDebouncedChange={setSearch}
          label="Search businesses"
          placeholder="Search businesses"
        />
        <SearchField
          appearance="outlined"
          onDebouncedChange={setSearch}
          label="Search in filters"
          placeholder="Outlined search"
        />
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Debounced value: {search ? `"${search}"` : "(empty)"}
        </p>
      </Demo>
    </GallerySection>
  );
}

export function PickersSection() {
  const [industry, setIndustry] = useState<string | null>("bakery");
  const [cities, setCities] = useState<string[]>(["ikeja", "lekki"]);
  const [size, setSize] = useState("50");
  return (
    <GallerySection
      id="pickers"
      title="Select and Combobox"
      description="Outlined pickers. Combobox filters locally or calls onSearchChange for server search."
    >
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-3">
        <FormField id="g-select" label="Record limit">
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger id="g-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["25", "50", "100", "250"].map((v) => (
                <SelectItem key={v} value={v}>
                  {v} records
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
        <FormField id="g-combobox" label="Industry">
          <Combobox
            id="g-combobox"
            options={INDUSTRY_OPTIONS}
            value={industry}
            onValueChange={setIndustry}
            placeholder="Select an industry"
            searchPlaceholder="Search industries"
            clearable
          />
        </FormField>
        <FormField id="g-multi" label="Locations">
          <MultiCombobox
            id="g-multi"
            options={CITY_OPTIONS}
            values={cities}
            onValuesChange={setCities}
            placeholder="Select locations"
            searchPlaceholder="Search locations"
          />
        </FormField>
        <FormField id="g-combobox-loading" label="Combobox loading">
          <Combobox
            id="g-combobox-loading"
            options={[]}
            value={null}
            onValueChange={() => {}}
            loading
            onSearchChange={() => {}}
            placeholder="Server search"
          />
        </FormField>
        <FormField id="g-combobox-disabled" label="Combobox disabled">
          <Combobox
            id="g-combobox-disabled"
            options={INDUSTRY_OPTIONS}
            value={null}
            onValueChange={() => {}}
            disabled
          />
        </FormField>
      </div>
    </GallerySection>
  );
}

export function SelectionControlsSection() {
  const [checked, setChecked] = useState<boolean | "indeterminate">("indeterminate");
  const [radio, setRadio] = useState("run-now");
  const [switchOn, setSwitchOn] = useState(true);
  const [segment, setSegment] = useState<"all" | "verified" | "unverified">("all");
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");
  const [filters, setFilters] = useState<Record<string, boolean>>({
    website: true,
    phone: false,
    email: false,
  });
  const [chips, setChips] = useState(["Industry: Bakery", "City: Ikeja", "Phone: Verified"]);

  return (
    <GallerySection
      id="selection"
      title="Selection controls"
      description="Checkbox, RadioGroup, Switch, SegmentedControl and Chips."
    >
      <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-3">
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs font-medium">Checkbox</p>
          <ChoiceField
            id="g-check-1"
            label="Select all on this page"
            control={<Checkbox checked={checked} onCheckedChange={setChecked} />}
          />
          <ChoiceField
            id="g-check-2"
            label="Exclude suppressed businesses"
            description="Suppressed records never appear in exports."
            control={<Checkbox defaultChecked />}
          />
          <ChoiceField id="g-check-3" label="Disabled" control={<Checkbox disabled />} />
        </div>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs font-medium" id="g-radio-label">
            RadioGroup
          </p>
          <RadioGroup value={radio} onValueChange={setRadio} aria-labelledby="g-radio-label">
            <div className="flex items-center gap-3">
              <RadioGroupItem value="run-now" id="g-radio-1" />
              <Label htmlFor="g-radio-1">Run now</Label>
            </div>
            <div className="flex items-center gap-3">
              <RadioGroupItem value="schedule" id="g-radio-2" disabled />
              <Label htmlFor="g-radio-2" className="text-muted-foreground">
                Schedule (coming soon)
              </Label>
            </div>
          </RadioGroup>
        </div>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-xs font-medium">Switch</p>
          <ChoiceField
            id="g-switch-1"
            label="Email me when a job fails"
            description="Sent to your account email."
            controlPosition="end"
            control={<Switch checked={switchOn} onCheckedChange={setSwitchOn} />}
          />
          <ChoiceField
            id="g-switch-2"
            label="Disabled switch"
            controlPosition="end"
            control={<Switch disabled />}
          />
        </div>
      </div>
      <Demo label="SegmentedControl">
        <SegmentedControl
          aria-label="Contact state"
          value={segment}
          onValueChange={setSegment}
          options={[
            { value: "all", label: "All" },
            { value: "verified", label: "Verified" },
            { value: "unverified", label: "Unverified" },
          ]}
        />
        <SegmentedControl
          aria-label="Period"
          size="sm"
          showCheck={false}
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "90d", label: "90 days" },
          ]}
        />
      </Demo>
      <Demo label="Chips: assist, filter, input">
        <Chip icon={<Sparkles aria-hidden />}>Suggest filters</Chip>
        {Object.entries(filters).map(([key, on]) => (
          <Chip
            key={key}
            variant="filter"
            selected={on}
            onClick={() => setFilters((f) => ({ ...f, [key]: !f[key] }))}
          >
            Has {key}
          </Chip>
        ))}
        {chips.map((c) => (
          <Chip
            key={c}
            variant="input"
            onRemove={() => setChips((all) => all.filter((x) => x !== c))}
          >
            {c}
          </Chip>
        ))}
        {chips.length === 0 ? (
          <Button
            variant="text"
            size="sm"
            onClick={() => setChips(["Industry: Bakery", "City: Ikeja", "Phone: Verified"])}
          >
            Reset chips
          </Button>
        ) : null}
        <Chip disabled>Disabled chip</Chip>
      </Demo>
    </GallerySection>
  );
}
