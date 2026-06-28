import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker } from "@/components/date-time-picker";
import { useCreateMessage } from "@/lib/queries";

const formSchema = z.object({
  recipient: z.string().min(1, "Enter a phone number"),
  body: z
    .string()
    .min(1, "Write a message")
    .max(2000, "Message is too long"),
  scheduledAt: z
    .date()
    .optional()
    .refine((value): value is Date => value instanceof Date, {
      message: "Choose a send date and time",
    }),
});

type FormValues = z.infer<typeof formSchema>;

export function keepPhoneChars(value: string): string {
  return value.replace(/[^\d+()\s-]/g, "");
}

export function ScheduleForm() {
  const createMessage = useCreateMessage();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { recipient: "", body: "" },
  });

  const onSubmit = async (values: FormValues) => {
    if (!values.scheduledAt) return;
    setServerError(null);
    try {
      await createMessage.mutateAsync({
        recipient: values.recipient,
        body: values.body,
        scheduledAt: values.scheduledAt.toISOString(),
      });
      form.reset({ recipient: "", body: "", scheduledAt: undefined });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "";
      setServerError(
        reason === "validation"
          ? "Please check the phone number and the scheduled time."
          : "We couldn't schedule that message. Please try again.",
      );
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        <FormField
          control={form.control}
          name="recipient"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone number</FormLabel>
              <FormControl>
                <Input
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="+1 (555) 123-4567"
                  className="h-11"
                  {...field}
                  onChange={(event) =>
                    field.onChange(keepPhoneChars(event.target.value))
                  }
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="body"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Message</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What would you like to send?"
                  className="min-h-[120px] resize-none"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="scheduledAt"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Send at</FormLabel>
              <FormControl>
                <DateTimePicker value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverError ? (
          <p className="text-destructive text-sm" role="alert">
            {serverError}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={createMessage.isPending}
          className="h-11 w-full bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-sm transition-opacity hover:opacity-90"
        >
          {createMessage.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Send className="size-4" />
          )}
          Schedule message
        </Button>
      </form>
    </Form>
  );
}