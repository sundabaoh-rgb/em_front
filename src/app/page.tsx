import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import AppHeader from "@/components/layout/AppHeader";
import AudioUploadPanel from "@/components/upload/AudioUploadPanel";
import { Separator } from "@/components/ui/separator";
import AppFooter from "@/components/layout/AppFooter";
import PreviewPane from "@/components/spectrogram/PreviewPane";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-muted/30 flex flex-col">
      <div className="flex-1">
        <div className="mx-auto max-w-6xl p-4 md:p-6 space-y-4">
          <AppHeader title="Главная" subtitle="Загрузка / запись и запуск анализа" />

          <div className="grid gap-4 lg:grid-cols-[420px_1fr] items-start">
            <div className="lg:sticky lg:top-6">
              <AudioUploadPanel />
            </div>

            <Card className="rounded-2xl border bg-background shadow-sm overflow-hidden">
              <CardHeader className="border-b">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Превью</CardTitle>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Полный результат - во вкладке «Во временном ряде».
                    </div>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-5">
                <PreviewPane />

                <Separator className="my-4" />

                <div className="text-sm text-muted-foreground">
                  Подсказка: выбери аудио слева и нажми «Отправить на обработку».
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="h-10 md:h-14" />
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
