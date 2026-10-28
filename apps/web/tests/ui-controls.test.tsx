import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  Checkbox,
  ChoiceField,
  Chip,
  Combobox,
  Label,
  MultiCombobox,
  RadioGroup,
  RadioGroupItem,
  SegmentedControl,
  Switch,
  TextField,
} from "@leadforge/ui";

const INDUSTRIES = [
  { value: "bakery", label: "Bakery" },
  { value: "clinic", label: "Clinic", description: "Health services" },
  { value: "laundry", label: "Laundry" },
  { value: "auto", label: "Auto repair", disabled: true },
];

describe("Combobox", () => {
  it("opens, moves the active option with arrow keys and selects with Enter", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Combobox
        aria-label="Industry"
        options={INDUSTRIES}
        value={null}
        onValueChange={onValueChange}
        placeholder="Choose an industry"
        searchPlaceholder="Search industries"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Industry" });
    expect(trigger).toHaveAttribute("aria-haspopup", "listbox");
    expect(trigger).toHaveTextContent("Choose an industry");

    await user.click(trigger);
    const input = await screen.findByRole("combobox", { name: "Search industries" });
    const listbox = screen.getByRole("listbox");
    expect(input).toHaveAttribute("aria-controls", listbox.id);
    const options = within(listbox).getAllByRole("option");
    expect(options).toHaveLength(4);
    expect(input).toHaveAttribute("aria-activedescendant", options[0]!.id);

    input.focus();
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[1]!.id);
    await user.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("clinic");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("skips disabled options and wraps around", async () => {
    const user = userEvent.setup();
    render(
      <Combobox aria-label="Industry" options={INDUSTRIES} value={null} onValueChange={() => {}} />,
    );
    await user.click(screen.getByRole("button", { name: "Industry" }));
    const input = await screen.findByRole("combobox");
    input.focus();
    await user.keyboard("{ArrowUp}");
    const laundry = screen.getByRole("option", { name: /Laundry/ });
    expect(input).toHaveAttribute("aria-activedescendant", laundry.id);
    expect(screen.getByRole("option", { name: /Auto repair/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("filters locally and shows the empty message", async () => {
    const user = userEvent.setup();
    render(
      <Combobox
        aria-label="Industry"
        options={INDUSTRIES}
        value={null}
        onValueChange={() => {}}
        emptyMessage="No industries match"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Industry" }));
    const input = await screen.findByRole("combobox");
    await user.type(input, "laun");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Laundry"]);
    await user.clear(input);
    await user.type(input, "health");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "ClinicHealth services",
    ]);
    await user.clear(input);
    await user.type(input, "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No industries match")).toBeInTheDocument();
  });

  it("reports queries for server search without filtering locally", async () => {
    const user = userEvent.setup();
    const onSearchChange = vi.fn();
    render(
      <Combobox
        aria-label="Location"
        options={INDUSTRIES}
        value="bakery"
        onValueChange={() => {}}
        onSearchChange={onSearchChange}
      />,
    );
    expect(screen.getByRole("button", { name: "Location" })).toHaveTextContent("Bakery");
    await user.click(screen.getByRole("button", { name: "Location" }));
    await user.type(await screen.findByRole("combobox"), "ik");
    expect(onSearchChange).toHaveBeenLastCalledWith("ik");
    expect(screen.getAllByRole("option")).toHaveLength(4);
    expect(screen.getByRole("option", { name: /Bakery/ })).toHaveAttribute("aria-selected", "true");
  });

  it("clears a selection with the clear button", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <Combobox
        aria-label="Industry"
        options={INDUSTRIES}
        value="clinic"
        onValueChange={onValueChange}
        clearable
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear Clinic" }));
    expect(onValueChange).toHaveBeenCalledWith(null);
  });
});

describe("MultiCombobox", () => {
  function Harness() {
    const [values, setValues] = useState<string[]>([]);
    return (
      <MultiCombobox
        aria-label="Industries"
        options={INDUSTRIES}
        values={values}
        onValuesChange={setValues}
        placeholder="Any industry"
      />
    );
  }

  it("toggles options, keeps the list open and removes chips", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Industries" });
    await user.click(trigger);
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    await user.click(within(listbox).getByRole("option", { name: "Bakery" }));
    await user.click(within(listbox).getByRole("option", { name: /Clinic/ }));
    expect(within(listbox).getByRole("option", { name: "Bakery" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(trigger).toHaveTextContent("2 selected");

    await user.keyboard("{Escape}");
    const selected = screen.getByRole("list", { name: "Selected" });
    expect(within(selected).getAllByRole("listitem")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Remove Bakery" }));
    expect(within(selected).getAllByRole("listitem")).toHaveLength(1);
    expect(trigger).toHaveTextContent("1 selected");
  });
});

describe("Checkbox, Switch and RadioGroup", () => {
  it("toggles a checkbox and supports the indeterminate state", async () => {
    const user = userEvent.setup();
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Accept terms" onCheckedChange={onCheckedChange} />);
    await user.click(screen.getByRole("checkbox", { name: "Accept terms" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
    render(<Checkbox aria-label="Select some" checked="indeterminate" />);
    expect(screen.getByRole("checkbox", { name: "Select some" })).toHaveAttribute(
      "aria-checked",
      "mixed",
    );
  });

  it("toggles a switch with the keyboard", async () => {
    const user = userEvent.setup();
    render(<Switch aria-label="Email notifications" />);
    const sw = screen.getByRole("switch", { name: "Email notifications" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    sw.focus();
    await user.keyboard(" ");
    expect(sw).toHaveAttribute("aria-checked", "true");
  });

  it("disables a switch", () => {
    render(<Switch aria-label="Locked" disabled />);
    expect(screen.getByRole("switch", { name: "Locked" })).toBeDisabled();
  });

  it("selects a radio item", async () => {
    const user = userEvent.setup();
    const onValueChange = vi.fn();
    render(
      <RadioGroup aria-label="Plan" defaultValue="monthly" onValueChange={onValueChange}>
        <div>
          <RadioGroupItem id="r-monthly" value="monthly" />
          <Label htmlFor="r-monthly">Monthly</Label>
        </div>
        <div>
          <RadioGroupItem id="r-yearly" value="yearly" />
          <Label htmlFor="r-yearly">Yearly</Label>
        </div>
      </RadioGroup>,
    );
    expect(screen.getByRole("radio", { name: "Monthly" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "Yearly" }));
    expect(onValueChange).toHaveBeenCalledWith("yearly");
  });

  it("ChoiceField labels and describes its control", () => {
    render(
      <ChoiceField
        id="cf-weekly"
        label="Weekly summary"
        description="Sent every Monday"
        control={<Switch />}
        controlPosition="end"
      />,
    );
    const sw = screen.getByRole("switch", { name: "Weekly summary" });
    expect(sw).toHaveAttribute("aria-describedby", "cf-weekly-description");
    expect(screen.getByText("Sent every Monday")).toHaveAttribute("id", "cf-weekly-description");
  });
});

describe("SegmentedControl", () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState("day");
    return (
      <SegmentedControl
        aria-label="Range"
        value={value}
        onValueChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={[
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month", disabled: true },
        ]}
      />
    );
  }

  it("has radiogroup semantics with a check icon on the selected segment", () => {
    render(<Harness onChange={() => {}} />);
    const group = screen.getByRole("radiogroup", { name: "Range" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]!.querySelector("svg")).not.toBeNull();
    expect(radios[1]!.querySelector("svg")).toBeNull();
    expect(radios[2]).toBeDisabled();
  });

  it("changes the selection with arrow keys", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    screen.getByRole("radio", { name: "Day" }).focus();
    // Radix moves focus on a timer and selects while the arrow key is still held, as in a browser.
    await user.keyboard("{ArrowRight>}");
    await new Promise((r) => setTimeout(r, 20));
    await user.keyboard("{/ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("week");
    expect(screen.getByRole("radio", { name: "Week" })).toHaveAttribute("aria-checked", "true");
  });

  it("changes the selection on click", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Week" }));
    expect(onChange).toHaveBeenCalledWith("week");
  });
});

describe("Chip", () => {
  it("filter chips expose aria-pressed and show a check when selected", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [on, setOn] = useState(false);
      return (
        <Chip variant="filter" selected={on} onClick={() => setOn((v) => !v)}>
          Verified only
        </Chip>
      );
    }
    render(<Harness />);
    const chip = screen.getByRole("button", { name: "Verified only" });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.querySelector("svg")).toBeNull();
    await user.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("input chips remove with the button or Backspace/Delete", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <Chip variant="input" onRemove={onRemove}>
        Lagos
      </Chip>,
    );
    const remove = screen.getByRole("button", { name: "Remove Lagos" });
    await user.click(remove);
    fireEvent.keyDown(remove, { key: "Backspace" });
    fireEvent.keyDown(remove, { key: "Delete" });
    expect(onRemove).toHaveBeenCalledTimes(3);
  });

  it("assist chips are plain buttons without aria-pressed", () => {
    render(<Chip>Add filter</Chip>);
    expect(screen.getByRole("button", { name: "Add filter" })).not.toHaveAttribute("aria-pressed");
  });
});

describe("TextField", () => {
  it("associates the floating label with the input", () => {
    render(<TextField id="tf-name" label="Organization name" />);
    const input = screen.getByLabelText("Organization name");
    expect(input).toHaveAttribute("id", "tf-name");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("wires hint and error with aria-describedby and aria-invalid", () => {
    const { rerender } = render(
      <TextField id="tf-email" label="Email" required hint="Use your work email." />,
    );
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("aria-describedby", "tf-email-hint");
    expect(input).toBeRequired();
    rerender(<TextField id="tf-email" label="Email" required error="Enter a valid email." />);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "tf-email-error");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid email.");
    expect(screen.queryByText("Use your work email.")).toBeNull();
  });

  it("reveals and hides a password", async () => {
    const user = userEvent.setup();
    render(<TextField id="tf-pass" label="Password" type="password" revealable />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("forwards its ref for form libraries", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<TextField id="tf-ref" label="Ref" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });
});
