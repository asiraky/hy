import { ExternalLinkIcon } from "lucide-react";
import { useId, useMemo, useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import type { PendingElicitation } from "~/protocol";

interface Props {
  request: PendingElicitation;
  onResolve(action: "accept" | "decline" | "cancel", value?: unknown): void;
}

export function ElicitationPrompt({ request, onResolve }: Props) {
  const properties = request.schema?.properties ?? {};
  const fieldId = useId();
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
    // Like the permission card, this blocks the turn — same band, same arrival.
    <form
      onSubmit={submit}
      aria-label="Input requested"
      className="attention-in border-attention/50 bg-attention-surface/60 shrink-0 border-t-2 px-4 py-3.5 md:px-5"
    >
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-[13px]">{request.prompt || "Input requested"}</p>

        {request.schema?.["x-url"] && (
          <a
            href={request.schema["x-url"]}
            target="_blank"
            rel="noreferrer"
            className="text-primary mb-3 inline-flex items-center gap-1.5 break-all underline underline-offset-4 text-[12px]"
          >
            {request.schema["x-url"]}
            <ExternalLinkIcon className="size-3 shrink-0" />
          </a>
        )}

        <div className="space-y-3">
          {Object.entries(properties).map(([key, field]) => {
            const id = `${fieldId}-${key}`;
            const required = request.schema.required?.includes(key);
            const set = (value: unknown) => setValues((old) => ({ ...old, [key]: value }));

            return (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={id}>{field.title || key}</Label>

                {field.enum ? (
                  <Select value={String(values[key] ?? "")} onValueChange={set} required={required}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {field.enum.map((option: string) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : field.type === "boolean" ? (
                  <div className="flex h-9 items-center">
                    <Switch id={id} checked={Boolean(values[key])} onCheckedChange={set} />
                  </div>
                ) : (
                  <Input
                    id={id}
                    type={
                      field.format === "password"
                        ? "password"
                        : field.type === "number" || field.type === "integer"
                          ? "number"
                          : "text"
                    }
                    required={required}
                    value={String(values[key] ?? "")}
                    onChange={(event) =>
                      set(
                        field.type === "number" || field.type === "integer"
                          ? Number(event.target.value)
                          : event.target.value,
                      )
                    }
                  />
                )}

                {field.description && (
                  <p className="text-muted-foreground text-[11px]">{field.description}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onResolve("decline")}>
            Decline
          </Button>
          <Button type="submit">Continue</Button>
        </div>
      </div>
    </form>
  );
}
