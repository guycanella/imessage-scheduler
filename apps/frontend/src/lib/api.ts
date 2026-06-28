import type { ScheduledMessage } from "@ims/shared";

export type StatusEventDto = {
  id: string;
  messageId: string;
  status: ScheduledMessage["status"];
  detail: string | null;
  createdAt: string;
};

export type MessageDetail = ScheduledMessage & { events: StatusEventDto[] };

export type CreateMessageInput = {
  recipient: string;
  body: string;
  scheduledAt: string;
};

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;

    try {
      const data = (await res.json()) as { error?: string };

      if (data?.error) message = data.error;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function listMessages(): Promise<ScheduledMessage[]> {
  return parse<ScheduledMessage[]>(await fetch("/api/messages"));
}

export async function createMessage(
  input: CreateMessageInput,
): Promise<ScheduledMessage> {
  const res = await fetch("/api/messages", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  
  return parse<ScheduledMessage>(res);
}