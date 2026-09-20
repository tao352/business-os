import React from "react";
import {
  MessageSquare,
  FileText,
  PhoneCall,
  Mail,
  Users,
  Activity as ActivityIcon,
  CheckCircle2,
  Calendar,
} from "lucide-react";
import { formatDateTime } from "@/lib/formatters";

export interface TimelineEvent {
  id: string;
  activity_type: string;
  summary: string;
  details?: any;
  author_name?: string;
  created_at: string;
}

interface LeadTimelineProps {
  events: TimelineEvent[];
}

export function LeadTimeline({ events }: LeadTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="py-8 text-center bg-surface-subtle border border-dashed border-line rounded-lg">
        <p className="text-xs text-ink-muted">
          No timeline activity recorded yet.
        </p>
      </div>
    );
  }

  const getEventIcon = (type: string) => {
    switch (type) {
      case "STATUS_CHANGE":
        return <ActivityIcon className="w-3.5 h-3.5 text-blue-600" />;
      case "NOTE":
        return <FileText className="w-3.5 h-3.5 text-zinc-600" />;
      case "WHATSAPP":
        return <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />;
      case "CALL":
        return <PhoneCall className="w-3.5 h-3.5 text-amber-600" />;
      case "EMAIL":
        return <Mail className="w-3.5 h-3.5 text-purple-600" />;
      case "MEETING":
        return <Calendar className="w-3.5 h-3.5 text-indigo-600" />;
      default:
        return <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />;
    }
  };

  return (
    <div className="relative pl-6 space-y-6 before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-[1px] before:bg-line">
      {events.map((event) => (
        <div key={event.id} className="relative group">
          {/* Timeline Node Bullet */}
          <div className="absolute -left-6 top-0.5 w-5 h-5 rounded-full bg-surface border border-line flex items-center justify-center shrink-0 shadow-none group-hover:border-ink-faint transition-colors">
            {getEventIcon(event.activity_type)}
          </div>

          <div className="text-xs">
            <div className="flex items-baseline justify-between gap-4">
              <span className="font-semibold text-ink">
                {event.author_name || "System"}
              </span>
              <span className="text-[11px] text-ink-faint whitespace-nowrap">
                {formatDateTime(event.created_at)}
              </span>
            </div>

            <div className="mt-1 text-ink-secondary leading-relaxed bg-surface border border-line-subtle rounded-md p-3">
              {event.summary}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
