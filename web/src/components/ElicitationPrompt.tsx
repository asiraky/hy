import { useMemo, useState, type FormEvent } from "react";
import type { PendingElicitation } from "../protocol";
import { Button } from "./ui";

interface Props {
  request: PendingElicitation;
  onResolve(action: "accept" | "decline" | "cancel", value?: unknown): void;
}

export function ElicitationPrompt({ request, onResolve }: Props) {
  const properties = request.schema?.properties ?? {};
  const initial = useMemo(
    () => Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, field.default ?? ""])),
    [properties],
  );
  const [values, setValues] = useState<Record<string, unknown>>(initial);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onResolve("accept", values);
  };

  return (
    <form onSubmit={submit} className="border-t border-ink-800 bg-ink-900 px-4 py-3">
      <p className="mb-3 text-[13px] text-ink-100">{request.prompt || "Input requested"}</p>

      {request.schema?.["x-url"] && (
        <a
          href={request.schema["x-url"]}
          target="_blank"
          rel="noreferrer"
          className="mb-3 block break-all text-[12px] text-blue-400 underline"
        >
          {request.schema["x-url"]}
        </a>
      )}

      <div className="space-y-3">
        {Object.entries(properties).map(([key, field]) => (
          <label key={key} className="block text-[11px] text-ink-400">
            <span className="mb-1 block text-[12px] text-ink-200">{field.title || key}</span>
            {field.enum ? (
              <select
                required={request.schema.required?.includes(key)}
                value={String(values[key] ?? "")}
                onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))}
                className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 text-ink-100"
              >
                <option value="" disabled>Select an option</option>
                {field.enum.map((option: string) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            ) : field.type === "boolean" ? (
              <input
                type="checkbox"
                checked={Boolean(values[key])}
                onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.checked }))}
              />
            ) : (
              <input
                type={field.format === "password" ? "password" : field.type === "number" || field.type === "integer" ? "number" : "text"}
                required={request.schema.required?.includes(key)}
                value={String(values[key] ?? "")}
                onChange={(event) => {
                  const value = field.type === "number" || field.type === "integer" ? Number(event.target.value) : event.target.value;
                  setValues((old) => ({ ...old, [key]: value }));
                }}
                className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 text-ink-100"
              />
            )}
            {field.description && <span className="mt-1 block">{field.description}</span>}
          </label>
        ))}
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" onClick={() => onResolve("decline")}>Decline</Button>
        <Button type="submit" variant="primary">Continue</Button>
      </div>
    </form>
  );
}
