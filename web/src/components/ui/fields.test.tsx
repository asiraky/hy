// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { render } from "~/test/harness";
import { Button } from "./button";
import { Input } from "./input";
import { Select, SelectTrigger, SelectValue } from "./select";

/**
 * A row of a select and two buttons is the shape half this app's forms take,
 * and it only reads as one control if every piece is the same height. These
 * assert the four primitives agree, at both breakpoints, without any caller
 * having to remember a one-off override.
 */

/** The height a class list asks for, as (phone, desktop). */
function heights(className: string): { phone: string; desktop: string } {
  // The select trigger scopes its height to its default size variant; that
  // qualifier is noise here, so it is dropped before matching.
  const classes = className.split(/\s+/).map((c) => c.replace("data-[size=default]:", ""));
  const pick = (prefix: string) =>
    classes.find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? "";
  const phone = pick("h-") || pick("size-");
  const desktop = pick("md:h-") || pick("md:size-");
  return { phone, desktop };
}

describe("field height", () => {
  it("is 44px on a phone and 36px from md up, for every control in a form row", () => {
    render(
      <>
        <Input aria-label="text" />
        <Button>Action</Button>
        <Button size="icon" aria-label="icon" />
        <Select>
          <SelectTrigger aria-label="select">
            <SelectValue />
          </SelectTrigger>
        </Select>
      </>,
    );

    const controls = [
      screen.getByLabelText("text"),
      screen.getByRole("button", { name: "Action" }),
      screen.getByRole("button", { name: "icon" }),
      screen.getByRole("combobox", { name: "select" }),
    ];

    for (const el of controls) {
      // 44px is the touch target on a phone; a pointer needs no such slack.
      expect(heights(el.className)).toEqual({ phone: "11", desktop: "9" });
    }
  });

  it("keeps a text field at 16px on a phone so iOS does not zoom the page", () => {
    render(<Input aria-label="text" />);
    const cls = screen.getByLabelText("text").className;
    // `text-base` is 16px; the smaller size is behind `md:`.
    expect(cls).toContain("text-base");
    expect(cls).toContain("md:text-sm");
  });
});
