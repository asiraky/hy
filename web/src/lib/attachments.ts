/**
 * Images attached to a prompt.
 *
 * The picture is uploaded the moment it is picked, not when the message is
 * sent: on a phone on 4G a 3 MB screenshot takes seconds, and paying for that
 * after hitting send would make the composer feel broken. By the time there is
 * a message to send, all that goes over the socket is a list of ids.
 */

/** What the server stores, and therefore what may be attached. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** Matches internal/attachment.MaxBytes. Rejected here so the phone finds out
    before it spends the upload rather than after. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The `accept` attribute for a file input. Deliberately the same list the
    server enforces: offering a HEIC that will be refused is worse than not
    offering it. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

export interface UploadedImage {
  id: string;
  mediaType: string;
  size: number;
}

/** One image in the composer, from picked to sendable. */
export interface Attachment {
  /** Local identity, stable across the upload. Not the server's id. */
  key: string;
  name: string;
  /** Object URL for the thumbnail, shown before the upload finishes. */
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  /** The server's id, present once uploaded. This is what the prompt names. */
  id?: string;
  error?: string;
}

export function isSupportedImage(file: File): boolean {
  return ACCEPTED_IMAGE_TYPES.includes(file.type);
}

/** Where a stored image is read back from. The device cookie rides the
    request, so this works straight from an `<img src>`. */
export function attachmentUrl(sessionId: string, id: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(id)}`;
}

/** Uploads one image and returns how the prompt will refer to it. */
export async function uploadAttachment(
  sessionId: string,
  file: File,
): Promise<UploadedImage> {
  const res = await fetch(
    `/api/sessions/${encodeURIComponent(sessionId)}/attachments`,
    {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    },
  );
  if (!res.ok) {
    const message = await res
      .json()
      .then((b: { error?: string }) => b.error)
      .catch(() => "");
    throw new Error(message || `upload failed (${res.status})`);
  }
  return (await res.json()) as UploadedImage;
}

/**
 * The images in a drop or a paste.
 *
 * A screenshot pasted from the clipboard arrives as a file with no useful
 * name, and a drag from a browser carries the picture alongside its URL as
 * text — so this reads files only, and leaves anything else to the textarea.
 */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter((f) => f.type.startsWith("image/"));
}

/** Whether a drag is carrying files at all, which decides if the composer
    should light up as a drop target. */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return Array.from(data?.types ?? []).includes("Files");
}
