import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type DateTimePickerProps = {
  value?: Date;
  onChange: (date: Date | undefined) => void;
  id?: string;
};

const display = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function toTimeValue(date: Date | undefined): string {
  if (!date) return "09:00";
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function DateTimePicker({ value, onChange, id }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const applyTimeTo = (base: Date, time: string): Date => {
    const [hours, minutes] = time.split(":").map(Number);
    const next = new Date(base);
    next.setHours(hours ?? 0, minutes ?? 0, 0, 0);
    return next;
  };

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) {
      onChange(undefined);
      return;
    }
    onChange(applyTimeTo(day, toTimeValue(value)));
  };

  const handleTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const base = value ?? new Date();
    onChange(applyTimeTo(base, event.target.value));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className={cn(
            "h-11 w-full justify-start text-left font-normal",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarIcon className="mr-2 size-4" />
          {value ? display.format(value) : "Pick a date and time"}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          onSelect={handleDaySelect}
          disabled={{ before: startOfToday() }}
          autoFocus
        />
        <div className="border-t p-3">
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            Time
          </label>
          <Input
            type="time"
            value={toTimeValue(value)}
            onChange={handleTimeChange}
            className="h-9"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}