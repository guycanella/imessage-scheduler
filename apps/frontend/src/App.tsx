import { ScheduleForm } from "@/components/schedule-form";
import { MessageList } from "@/components/message-list";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <main className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            iMessage Scheduler
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Queue a message and we'll send it at the time you choose.
          </p>
        </header>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>New message</CardTitle>
              <CardDescription>
                Pick a recipient, write your text, and schedule the send.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScheduleForm />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Scheduled messages</CardTitle>
              <CardDescription>Status updates live as they send.</CardDescription>
            </CardHeader>
            <CardContent>
              <MessageList />
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}