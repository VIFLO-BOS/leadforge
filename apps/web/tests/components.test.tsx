import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, ConfirmDialog, SearchField, StatusIndicator } from "@leadforge/ui";

describe("Button", () => {
  it("sets aria-busy and disables itself while loading", () => {
    render(<Button loading>Save</Button>);
    const btn = screen.getByRole("button", { name: /save/i });
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toBeDisabled();
  });

  it("renders as a link when asChild is used", () => {
    render(
      <Button asChild>
        <a href="/x">Go</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Go" })).toHaveAttribute("href", "/x");
  });
});

describe("SearchField", () => {
  it("debounces onDebouncedChange and trims the value", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    render(<SearchField onDebouncedChange={spy} delay={300} />);
    const input = screen.getByRole("searchbox", { name: "Search" });

    fireEvent.change(input, { target: { value: "ba" } });
    fireEvent.change(input, { target: { value: "bak" } });
    fireEvent.change(input, { target: { value: " bakery " } });
    expect(spy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(spy).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("bakery");
    vi.useRealTimers();
  });

  it("offers a clear button only when there is text", () => {
    render(<SearchField onDebouncedChange={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});

describe("StatusIndicator", () => {
  it("always includes a visible text label alongside the colored dot", () => {
    render(<StatusIndicator tone="success" label="Verified" />);
    expect(screen.getByText("Verified")).toBeVisible();
  });
});

describe("ConfirmDialog", () => {
  it("keeps confirm disabled until the phrase is typed, then calls onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        onOpenChange={() => {}}
        title="Delete organization?"
        confirmLabel="Delete"
        confirmPhrase="DELETE"
        destructive
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByRole("button", { name: "Delete" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELET" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "DELETE" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("exposes an alertdialog role", () => {
    render(<ConfirmDialog open onOpenChange={() => {}} title="Sure?" onConfirm={() => {}} />);
    expect(screen.getByRole("alertdialog", { name: "Sure?" })).toBeInTheDocument();
  });
});

describe("cn", () => {
  it("keeps custom font-size tokens alongside colour utilities", async () => {
    const { cn } = await import("@leadforge/ui");
    expect(cn("text-h3", "text-muted-foreground")).toBe("text-h3 text-muted-foreground");
    expect(cn("text-h3", "text-h4")).toBe("text-h4");
    expect(cn("shadow-1", "shadow-3")).toBe("shadow-3");
  });
});

describe("initials", () => {
  it("skips words that do not start with a letter", async () => {
    const { initials } = await import("@leadforge/ui");
    expect(initials("Ada Okafor (Sample)")).toBe("AO");
    expect(initials("(Sample)")).toBe("?");
  });
});
