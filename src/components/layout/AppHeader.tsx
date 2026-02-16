"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTaskStore } from "@/store/taskStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import AccountMenu from "@/components/layout/AccountMenu";

/**
 * Возвращает вариант кнопки навигации в зависимости от активного роутинга.
 *
 * Принцип:
 * - active → более заметная (default)
 * - inactive → вторичная (secondary)
 */
function navBtnVariant(active: boolean) {
  return active ? "default" : "secondary";
}

/**
 * AppHeader
 *
 * Универсальный хедер приложения:
 * - отображает заголовок и подзаголовок текущей страницы
 * - показывает статус/прогресс текущей задачи (task store)
 * - содержит навигацию (desktop + mobile) и меню аккаунта
 *
 * Источники данных:
 * - Next.js router (`usePathname`) для подсветки активного пункта меню
 * - Zustand (`useTaskStore`) для taskId, статуса, прогресса и ошибок
 */
export default function AppHeader({
  title,
  subtitle,
}: {
  /** Заголовок текущей страницы (H1) */
  title: string;
  /** Опциональный подзаголовок страницы */
  subtitle?: string;
}) {
  /**
   * Текущий путь — используется для определения активной вкладки навигации.
   */
  const pathname = usePathname();

  /**
   * Данные текущей задачи из стора.
   */
  const status = useTaskStore((s) => s.status);
  const taskId = useTaskStore((s) => s.taskId);
  const progress = useTaskStore((s) => s.progress);
  const error = useTaskStore((s) => s.error);

  /**
   * Человекочитаемая подпись статуса для UI.
   * Важно: статус хранится как machine-friendly значение,
   * а на UI выводим локализованную метку.
   */
  const statusLabel =
    status === "done"
      ? "готово"
      : status === "processing"
      ? "обработка"
      : status === "queued"
      ? "в очереди"
      : status === "error"
      ? "ошибка"
      : "idle";

  /**
   * Вариант Badge для статуса: ошибки подсвечиваем как destructive,
   * остальные статусы — нейтральным secondary.
   */
  const badgeVariant = status === "error" ? "destructive" : "secondary";

  /**
   * Флаги активного роутинга для подсветки кнопок.
   */
  const isHome = pathname === "/";
  const isTimeline = pathname.startsWith("/timeline");

  return (
    <header className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">
            {title}
          </h1>
          <Badge variant={badgeVariant}>{statusLabel}</Badge>
        </div>

        {subtitle ? (
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>task:</span>
          <code className="rounded bg-muted px-2 py-0.5">{taskId ?? "—"}</code>

          {typeof progress === "number" ? (
            <span>progress: {(progress * 100).toFixed(0)}%</span>
          ) : null}

          {error ? <span className="text-red-600">{error}</span> : null}
        </div>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <div className="hidden sm:flex items-center gap-2">
          <Button asChild variant={navBtnVariant(isHome)}>
            <Link href="/">Главная</Link>
          </Button>

          <Button asChild variant={navBtnVariant(isTimeline)}>
            <Link href="/timeline">Во временном ряде</Link>
          </Button>
        </div>

        <div className="sm:hidden flex items-center gap-2">
          <Button asChild size="sm" variant={navBtnVariant(isHome)}>
            <Link href="/">Главная</Link>
          </Button>
          <Button asChild size="sm" variant={navBtnVariant(isTimeline)}>
            <Link href="/timeline">Ряд</Link>
          </Button>
        </div>
        <AccountMenu />
      </div>
    </header>
  );
}
