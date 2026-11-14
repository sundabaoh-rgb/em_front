import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppHeader from "@/components/layout/AppHeader";
import AudioUploadPanel from "@/components/upload/AudioUploadPanel";
import AppFooter from "@/components/layout/AppFooter";
import PreviewPane from "@/components/spectrogram/PreviewPane";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-background flex flex-col">
      <div className="flex-1">
        <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8 space-y-6">
          <AppHeader title="Главная" subtitle="Загрузка или запись аудио и запуск нейросетевого анализа" />

          <div className="grid gap-6 lg:grid-cols-[400px_1fr] items-start">
            <div className="lg:sticky lg:top-6">
              <AudioUploadPanel />
            </div>

            <Card className="overflow-hidden">
              <CardHeader className="border-b bg-slate-50/50 py-3.5 px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Превью анализа</CardTitle>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Предпросмотр сигнала, мел-спектрограммы и основной эмоции
                    </p>
                  </div>

                  <Link
                    href="/timeline"
                    className="inline-flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-2xs transition-colors hover:bg-slate-50"
                  >
                    <span>Во временном ряде</span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                </div>
              </CardHeader>

              <CardContent className="p-5">
                <PreviewPane />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AppFooter
        brand="Emotion detection"
        meta="v0.1 • demo"
        githubUrl="#"
        email="support@example.com"
        links={[
          { label: "Документация", href: "#" },
          { label: "Приватность", href: "#" },
          { label: "Поддержка", href: "#" },
        ]}
      />
    </main>
  );
}