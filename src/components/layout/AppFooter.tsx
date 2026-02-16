// components/layout/AppFooter.tsx
"use client";

import React from "react";
import {
  Github,
  Mail,
  Shield,
  Sparkles,
  ExternalLink,
} from "lucide-react";

const FOOTER_TINT = "rgba(30, 30, 30, 0.06)";

const TOP_HAIRLINE = "rgba(0, 0, 0, 0.05)";
const CHIP_BG = "rgba(255, 255, 255, 0.55)";
const CHIP_BORDER = "rgba(0, 0, 0, 0.08)";
const LINK_HOVER_BG = "rgba(0, 0, 0, 0.04)";

type AppFooterProps = {
  brand?: string;
  meta?: string;
  showMadeWith?: boolean;
  links?: Array<{ label: string; href: string }>;
  email?: string;
  githubUrl?: string;
  copyrightText?: string;
};

function isExternal(href: string) {
  return /^https?:\/\//i.test(href) || href.startsWith("mailto:");
}

export default function AppFooter({
  brand = "Emotion detection",
  meta = "preview",
  showMadeWith = true,
  links = [
    { label: "Документация", href: "#" },
    { label: "Приватность", href: "#" },
    { label: "Поддержка", href: "#" },
  ],
  email,
  githubUrl,
  copyrightText,
}: AppFooterProps) {
  const year = new Date().getFullYear();
  const copy = copyrightText ?? `© ${year} ${brand}. Все права защищены.`;

  return (
    <footer className="mt-10">
      <div className="w-full" style={{ backgroundColor: FOOTER_TINT }}>
        <div
          className="h-px w-full"
          style={{
            backgroundColor: TOP_HAIRLINE,
            boxShadow: "0 -1px 0 rgba(0,0,0,0.03)",
          }}
        />

        <div className="mx-auto max-w-6xl px-4 pb-10 pt-6 md:px-6 md:pb-12 md:pt-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-start">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <div
                  className="grid h-9 w-9 place-items-center rounded-2xl border"
                  style={{
                    backgroundColor: CHIP_BG,
                    borderColor: CHIP_BORDER,
                  }}
                >
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                </div>

                <div className="leading-tight">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold">{brand}</div>

                    <span
                      className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground"
                      style={{
                        backgroundColor: CHIP_BG,
                        borderColor: CHIP_BORDER,
                      }}
                    >
                      {meta}
                    </span>
                  </div>
                </div>
              </div>

              <p className="max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
                Загружай или записывай аудио - получай спектрограмму, сегменты и признаки.
                Основной анализ доступен во вкладке «Во временном ряде».
              </p>

              <div className="flex flex-wrap gap-2">
                <span
                  className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground"
                  style={{
                    backgroundColor: CHIP_BG,
                    borderColor: CHIP_BORDER,
                  }}
                >
                  <Shield className="h-3.5 w-3.5" />
                  Безопасно
                </span>

                {showMadeWith && (
                  <span
                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground"
                    style={{
                      backgroundColor: CHIP_BG,
                      borderColor: CHIP_BORDER,
                    }}
                  >
                    Сделано и ладно ... 
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 md:justify-self-end">
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                {links.map((l) => {
                  const ext = isExternal(l.href);
                  return (
                    <a
                      key={l.href + l.label}
                      href={l.href}
                      target={ext ? "_blank" : undefined}
                      rel={ext ? "noreferrer" : undefined}
                      className="rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:text-foreground"
                      style={{}}
                      onMouseEnter={(e) => {
                        (e.currentTarget.style.backgroundColor = LINK_HOVER_BG);
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget.style.backgroundColor = "transparent");
                      }}
                    >
                      {l.label}
                    </a>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {githubUrl && (
                  <a
                    href={githubUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                    style={{
                      backgroundColor: CHIP_BG,
                      borderColor: CHIP_BORDER,
                    }}
                  >
                    <Github className="h-4 w-4" />
                    GitHub
                    <ExternalLink className="h-3.5 w-3.5 opacity-60" />
                  </a>
                )}

                {email && (
                  <a
                    href={`mailto:${email}`}
                    className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm text-muted-foreground transition hover:text-foreground"
                    style={{
                      backgroundColor: CHIP_BG,
                      borderColor: CHIP_BORDER,
                    }}
                  >
                    <Mail className="h-4 w-4" />
                    <span className="max-w-[240px] truncate">{email}</span>
                  </a>
                )}
              </div>
              <div className="text-xs text-muted-foreground/80">{copy}</div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
