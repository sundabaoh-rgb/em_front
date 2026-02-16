"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUp } from "lucide-react";

type Props = {
  /**
   * CSS selector куда скроллить.
   * Например "#timeline-tabs" (мы поставим id на TabsList/контейнер).
   */
  targetSelector?: string;
  /**
   * Порог, после которого кнопка появляется (px)
   */
  showAfterPx?: number;
};

export default function ScrollToTopFab({
  targetSelector = "body",
  showAfterPx = 120,
}: Props) {
  const [show, setShow] = useState(false);

  const canSmooth = useMemo(() => {
    if (typeof window === "undefined") return false;
    return "scrollBehavior" in document.documentElement.style;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setShow(window.scrollY > showAfterPx);
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, [showAfterPx]);

  const scrollToTarget = () => {
    if (typeof window === "undefined") return;

    const el =
      targetSelector === "body"
        ? document.body
        : (document.querySelector(targetSelector) as HTMLElement | null);

    if (!el) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const top = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 14);

    // fallback на старых браузерах
    if (!canSmooth) {
      window.scrollTo(0, top);
      return;
    }

    window.scrollTo({ top, behavior: "smooth" });
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <Button
        type="button"
        size="icon"
        onClick={scrollToTarget}
        className={[
          "h-12 w-12 rounded-full shadow-lg",
          "bg-background/80 backdrop-blur border",
          "hover:bg-background",
          "cursor-pointer",
        ].join(" ")}
        variant="secondary"
        aria-label="Наверх"
        title="Наверх"
      >
        <ArrowUp className="h-5 w-5" />
      </Button>
    </div>
  );
}
