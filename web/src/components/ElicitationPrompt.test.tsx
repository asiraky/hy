// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { render } from "~/test/harness";
import { ElicitationPrompt } from "./ElicitationPrompt";
import type { PendingElicitation } from "~/protocol";

// The shape the Claude AskUserQuestion bridge produces: an enum field carrying
// the x- hints for multi-select, a free-text escape, and per-option rationale.
function multiSelectRequest(): PendingElicitation {
  return {
    requestId: "r-auq",
    prompt: "The assistant needs your input to continue.",
    schema: {
      type: "object",
      properties: {
        q0: {
          type: "string",
          title: "Which features?",
          enum: ["Caching", "Metrics", "Tracing"],
          "x-multiSelect": true,
          "x-allowOther": true,
          "x-optionDescriptions": { Caching: "faster reads" },
        },
      },
    },
  };
}

describe("AskUserQuestion elicitations", () => {
  it("collects several checkbox answers as an array", () => {
    const onResolve = vi.fn();
    render(<ElicitationPrompt request={multiSelectRequest()} onResolve={onResolve} />);

    // Caching, Metrics, Tracing, then Other.
    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]); // Caching
    fireEvent.click(boxes[2]); // Tracing
    fireEvent.click(screen.getByText("Continue"));

    expect(onResolve).toHaveBeenCalledWith("accept", { q0: ["Caching", "Tracing"] });
  });

  it("shows each option's description", () => {
    render(<ElicitationPrompt request={multiSelectRequest()} onResolve={vi.fn()} />);
    expect(screen.getByText("faster reads")).toBeTruthy();
  });

  it("appends a free-text Other answer", () => {
    const onResolve = vi.fn();
    render(<ElicitationPrompt request={multiSelectRequest()} onResolve={onResolve} />);

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]); // Caching
    fireEvent.click(boxes[3]); // Other
    fireEvent.change(screen.getByLabelText("Other answer"), { target: { value: "Batching" } });
    fireEvent.click(screen.getByText("Continue"));

    expect(onResolve).toHaveBeenCalledWith("accept", { q0: ["Caching", "Batching"] });
  });

  it("leaves a plain enum elicitation as a single-select with no checkboxes", () => {
    const request: PendingElicitation = {
      requestId: "r-plain",
      prompt: "Pick one",
      schema: {
        type: "object",
        properties: { choice: { type: "string", enum: ["a", "b"] } },
      },
    };
    render(<ElicitationPrompt request={request} onResolve={vi.fn()} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
