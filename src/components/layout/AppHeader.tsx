"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTaskStore } from "@/store/taskStore";
import AccountMenu from "@/components/layout/AccountMenu";
import { AudioWaveform, BarChart3, Home } from "lucide-react";

export default function AppHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  const pathname = usePathname();

  const status = useTaskStore((s) => s.status);
  const taskId = useTaskStore((s) => s.taskId);
  const progress = useTaskStore((s) => s.progress);
  const error = useTaskStore((s) => s.error);

  const statusMeta =
    status === "done"
      ? { label: "Готово", dot: "bg-emerald-500", bg: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20" }
      : status === "processing"
      ? { label: "В обработке", dot: "bg-amber-500 animate-pulse", bg: "bg-amber-500/10 text-amber-700 border-amber-500/20" }
      : status === "queued"
      ? { label: "В очереди", dot: "bg-blue-500 animate-pulse", bg: "bg-blue-500/10 text-blue-700 border-blue-500/20" }
      : status === "error"
      ? { label: "Ошибка", dot: "bg-red-500", bg: "bg-red-500/10 text-red-700 border-red-500/20" }
      : { label: "Ожидание", dot: "bg-slate-400", bg: "bg-slate-100 text-slate-600 border-slate-200" };

  const isHome = pathname === "/";
  const isTimeline = pathname.startsWith("/timeline");

  const shortTaskId = taskId ? `#${taskId.slice(0, 6)}` : null;

  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-5">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-2xs">
            <AudioWaveform className="h-4 w-4" />
          </div>

          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusMeta.bg}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
            {typeof progress === "number" && (status === "processing" || status === "queued") ? (
              <span className="tabular-nums opacity-80">({(progress * 100).toFixed(0)}%)</span>
            ) : null}
          </span>

          {shortTaskId ? (
            <span
              title={`Task ID: ${taskId}`}
              className="hidden md:inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-muted-foreground border border-slate-200/60"
            >
              {shortTaskId}
            </span>
          ) : null}
        </div>

        {subtitle ? (
          <p className="text-xs md:text-sm text-muted-foreground">{subtitle}</p>
        ) : null}

        {error ? (
          <p className="text-xs font-medium text-red-600">{error}</p>
        ) : null}
      </div>

      <div className="shrink-0 flex items-center gap-2.5">
        {/* Единый блок навигации (segmented control) */}
        <nav className="inline-flex items-center rounded-xl bg-slate-200/70 p-1 border border-slate-200/60">
          <Link
            href="/"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isHome
                ? "bg-white text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Home className="h-3.5 w-3.5" />
            <span>Главная</span>
          </Link>

          <Link
            href="/timeline"
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
              isTimeline
                ? "bg-white text-foreground shadow-2xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Во временном ряде</span>
            <span className="sm:hidden">Ряд</span>
          </Link>
        </nav>

        <AccountMenu />
      </div>
    </header>
  );
}