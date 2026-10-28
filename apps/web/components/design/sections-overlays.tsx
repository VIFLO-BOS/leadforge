"use client";

import {
  Bell,
  Building2,
  Copy,
  Download,
  Ellipsis,
  Globe,
  Info,
  Pencil,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Parallax,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Reveal,
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Stagger,
  StaggerItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  TextField,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@leadforge/ui";
import { Demo, GallerySection } from "./section";

export function OverlaysSection() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phraseOpen, setPhraseOpen] = useState(false);
  const [showSources, setShowSources] = useState(true);
  const [sort, setSort] = useState("score");

  return (
    <GallerySection
      id="overlays"
      title="Dialogs, sheets and menus"
      description="Dialogs are full-screen under 480px with sticky header and footer. Sheets are full width under 480px."
    >
      <Demo label="Dialog and ConfirmDialog">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Correct a field</DialogTitle>
              <DialogDescription>
                Your correction is stored as a new observation with source &ldquo;user edit&rdquo;.
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-5 pt-3 [--field-bg:var(--surface-elevated)]">
              <TextField
                id="g-dialog-phone"
                label="Phone number"
                defaultValue="+234 801 234 5678 (Sample)"
              />
              <TextField
                id="g-dialog-note"
                label="Reason"
                hint="Visible in the provenance trail."
              />
            </DialogBody>
            <DialogFooter>
              <Button variant="text">Cancel</Button>
              <Button>Save correction</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" onClick={() => setConfirmOpen(true)}>
          Confirm dialog
        </Button>
        <Button variant="destructive" onClick={() => setPhraseOpen(true)}>
          Typed-phrase confirm
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Cancel this discovery job?"
          description="Records already collected stay in your workspace. Unused credits are released."
          confirmLabel="Cancel job"
          cancelLabel="Keep running"
          onConfirm={() => setConfirmOpen(false)}
        />
        <ConfirmDialog
          open={phraseOpen}
          onOpenChange={setPhraseOpen}
          title="Delete 24 businesses?"
          description="This removes the records and their provenance from this workspace."
          confirmPhrase="DELETE 24"
          confirmLabel="Delete"
          destructive
          onConfirm={() => setPhraseOpen(false)}
        />
      </Demo>

      <Demo label="Sheets">
        {(["left", "right", "bottom"] as const).map((side) => (
          <Sheet key={side}>
            <SheetTrigger asChild>
              <Button variant="tonal">Sheet {side}</Button>
            </SheetTrigger>
            <SheetContent side={side}>
              <SheetHeader>
                <SheetTitle className="text-xl font-normal leading-7">Business details</SheetTitle>
                <SheetDescription className="text-muted-foreground text-sm">
                  Adunni Bakery (Sample)
                </SheetDescription>
              </SheetHeader>
              <SheetBody className="flex flex-col gap-3 text-sm">
                <p>Sheets hold navigation on small screens and detail drawers on large ones.</p>
                <p className="text-muted-foreground">
                  Source: Places API (Sample), collected 12 Oct 2026.
                </p>
              </SheetBody>
              <SheetFooter>
                <Button>Open full record</Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ))}
      </Demo>

      <Demo label="Popover, DropdownMenu, Tooltip">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline">
              <Info aria-hidden /> Why this score?
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            <p className="font-medium">Fit score 82 (Sample)</p>
            <p className="text-muted-foreground mt-1">
              Score reflects fit with your configured criteria. It is not a prediction of purchase
              intent.
            </p>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="More actions">
              <Ellipsis aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Record</DropdownMenuLabel>
            <DropdownMenuItem>
              <Pencil aria-hidden /> Correct a field
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Copy aria-hidden /> Copy record ID
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Download aria-hidden /> Export
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuItem>CSV</DropdownMenuItem>
                <DropdownMenuItem disabled>Excel (coming soon)</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={showSources}
              onCheckedChange={(v) => setShowSources(v === true)}
            >
              Show sources
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Sort by</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={sort} onValueChange={setSort}>
              <DropdownMenuRadioItem value="score">Fit score</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive>
              <Trash2 aria-hidden /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Verification method">
              <ShieldCheck aria-hidden />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Verified by MX check (Sample)</TooltipContent>
        </Tooltip>
      </Demo>

      <Demo label="Snackbar toasts">
        <Button variant="outline" onClick={() => toast("Business added to list (Sample)")}>
          Plain
        </Button>
        <Button
          variant="outline"
          onClick={() =>
            toast("Field corrected (Sample)", { action: { label: "Undo", onClick: () => {} } })
          }
        >
          With action
        </Button>
        <Button variant="outline" onClick={() => toast.success("Invitation sent (Sample)")}>
          Success
        </Button>
        <Button
          variant="outline"
          onClick={() => toast.error("Could not reach the server (Sample)")}
        >
          Error
        </Button>
      </Demo>

      <Demo label="Tabs" className="block">
        <Tabs defaultValue="overview">
          <TabsList aria-label="Business sections">
            <TabsTrigger value="overview">
              <Building2 aria-hidden /> Overview
            </TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="provenance">Provenance</TabsTrigger>
            <TabsTrigger value="website">
              <Globe aria-hidden /> Website analysis
            </TabsTrigger>
            <TabsTrigger value="activity" disabled>
              Activity (coming soon)
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="text-sm">
            Overview panel for Adunni Bakery (Sample).
          </TabsContent>
          <TabsContent value="contacts" className="text-sm">
            Contacts with field states.
          </TabsContent>
          <TabsContent value="provenance" className="text-sm">
            Every observation with source and date.
          </TabsContent>
          <TabsContent value="website" className="text-sm">
            No contact form was detected (Sample).
          </TabsContent>
        </Tabs>
      </Demo>
    </GallerySection>
  );
}

export function MotionSection() {
  const [key, setKey] = useState(0);
  return (
    <GallerySection
      id="motion"
      title="Motion primitives"
      description="Reveal, Stagger and Parallax. Final state on the server and under reduced motion; transform and opacity only."
    >
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setKey((k) => k + 1)}
      >
        <Bell aria-hidden /> Replay
      </Button>
      <div key={key} className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3">
        <Reveal>
          <Card variant="filled" className="p-5 text-sm">
            Reveal: 500ms, 24px rise, emphasized decelerate.
          </Card>
        </Reveal>
        <Stagger as="ul" className="flex flex-col gap-2">
          {["Discover", "Enrich", "Qualify"].map((s) => (
            <StaggerItem as="li" key={s}>
              <Card variant="tonal" className="px-4 py-3 text-sm">
                Stagger: {s}
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
        <div className="bg-surface-container-low relative h-40 overflow-hidden rounded-lg">
          <Parallax distance={60} className="absolute inset-x-4 top-8">
            <Card className="p-4 text-sm">Parallax layer inside an overflow-hidden frame.</Card>
          </Parallax>
        </div>
      </div>
    </GallerySection>
  );
}
