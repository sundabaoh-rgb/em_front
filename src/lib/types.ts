/**
 * Статус задачи обработки аудио.
 *
 * Используется как:
 * - backend → frontend контракт
 * - UI-маркер (badge, прогресс, ошибки)
 */
export type TaskStatus = "queued" | "processing" | "done" | "error";

/**
 * Сегмент временного ряда (эмоция / класс / состояние).
 *
 * ВАЖНО:
 * - endFrame считается EXCLUSIVE → диапазон [startFrame, endFrame)
 *   Это упрощает работу с целочисленными кадрами и предотвращает перекрытия.
 */
export type EmotionSegment = {
  /** Уникальный идентификатор сегмента (backend-side). */
  id: string;

  /** Сырой текстовый лейбл (например: "anger", "joy", "truth"). */
  label: string;

  /** Начальный кадр (inclusive). */
  startFrame: number;

  /** Конечный кадр (EXCLUSIVE). */
  endFrame: number;
};

/**
 * Одна строка таблицы признаков.
 *
 * name   — имя признака (MFCC_1, ZCR, energy, и т.п.)
 * values — значения по колонкам (обычно числа, но допускаем строки)
 */
export type FeatureRow = {
  /** Имя признака. */
  name: string;

  /** Значения признака по колонкам. */
  values: (number | string)[];
};

/**
 * Полезная нагрузка спектрограммы.
 *
 * Сейчас поддерживается только MEL-спектрограмма,
 * но тип намеренно сделан расширяемым.
 */
export type SpectrogramPayload = {
  /** Тип спектрограммы. */
  type: "mel";

  /** Количество временных кадров. */
  frames: number;

  /** Количество mel-бинов (частотных полос). */
  melBins: number;

  /** Шаг окна STFT / hop length (в сэмплах). */
  hopLength: number;

  /**
   * Минимальный уровень в dB (опционально).
   * Используется для реальной шкалы, если backend её присылает.
   */
  minDb?: number;

  /**
   * Максимальный уровень в dB (опционально).
   */
  maxDb?: number;

  /**
   * Формат данных спектрограммы.
   * Сейчас стандарт — uint8 (0..255), удобно для canvas/LUT.
   */
  format: "uint8";

  /**
   * Base64-строка бинарных данных.
   * Длина после декодирования = frames * melBins.
   */
  data: string;
};

/**
 * Ответ backend'а для завершённой задачи.
 *
 * status = "done" → все основные поля присутствуют.
 */
export type TaskDoneResponse = {
  /** Идентификатор задачи. */
  taskId: string;

  /** Финальный статус. */
  status: "done";

  /**
   * Информация об аудио (опционально).
   * durationSec может отсутствовать (например, если не удалось вычислить).
   */
  audio?: {
    durationSec?: number;
    sampleRate: number;
  };

  /** Спектрограмма (обязательна для done). */
  spectrogram: SpectrogramPayload;

  /**
   * Сводка анализа (опционально).
   */
  summary?: {
    /** Основная эмоция (топ-1). */
    mainEmotion?: string;

    /**
     * Вероятности эмоций (label → probability).
     * probability ∈ [0..1]
     */
    emotionProb?: Record<string, number>;
  };

  /** Сегменты временного ряда. */
  segments: EmotionSegment[];

  /**
   * Низкоуровневые признаки (опционально).
   */
  features?: {
    columns: string[];
    rows: FeatureRow[];
  };
};

/**
 * Ответ backend'а для задачи в процессе выполнения.
 *
 * status = "queued" | "processing"
 */
export type TaskProgressResponse = {
  taskId: string;
  status: "queued" | "processing";

  /**
   * Прогресс выполнения ∈ [0..1].
   * Может отсутствовать, если backend его не считает.
   */
  progress?: number;
};

/**
 * Ответ backend'а в случае ошибки.
 */
export type TaskErrorResponse = {
  taskId: string;
  status: "error";

  /** Человекочитаемое сообщение об ошибке. */
  error: string;

  /**
   * Машинный код ошибки (опционально).
   * Удобно для маппинга на UI-сообщения.
   */
  errorCode?: string;
};

/**
 * Универсальный ответ по задаче.
 *
 * Discriminated union по полю `status`.
 * Очень удобно для:
 *   switch (resp.status) { ... }
 */
export type TaskResponse =
  | TaskDoneResponse
  | TaskProgressResponse
  | TaskErrorResponse;

/**
 * Ответ на загрузку аудио.
 *
 * ok = true  → задача создана
 * ok = false → ошибка загрузки
 */
export type UploadResponse =
  | {
      ok: true;
      taskId: string;
      status: TaskStatus;
    }
  | {
      ok: false;
      error: string;
    };
