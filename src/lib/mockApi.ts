export type EmotionSegment = {
  id: string;
  label: string;
  startFrame: number;
  endFrame: number;
};

export type FeatureRow = {
  name: string;
  values: (number | string)[];
};

export type SpectrogramResponse = {
  frames: number;
  melBins: number;
  hopLength: number;
  sampleRate: number;

  mel: Uint8Array;

  segments: EmotionSegment[];

  mainEmotion: string;

  features: {
    columns: string[];
    rows: FeatureRow[];
  };
};

function genMel(frames: number, bins: number) {
  const arr = new Uint8Array(frames * bins);

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
  const gauss = (x: number, mu: number, sigma: number) => {
    const z = (x - mu) / sigma;
    return Math.exp(-0.5 * z * z);
  };


  const basePitch = 6;
  const pitchVar = 2.5;

  for (let f = 0; f < frames; f++) {
    const t = f / frames;

    const isPause = (t > 0.18 && t < 0.23) || (t > 0.58 && t < 0.62);
    const isFricative = (t > 0.33 && t < 0.38) || (t > 0.78 && t < 0.84);

    const F1 = 12 + 4 * Math.sin(2 * Math.PI * (t * 1.2 + 0.1));
    const F2 = 30 + 7 * Math.sin(2 * Math.PI * (t * 0.9 + 0.4));
    const F3 = 52 + 5 * Math.sin(2 * Math.PI * (t * 0.7 + 0.2));

    const pitch = basePitch + pitchVar * Math.sin(2 * Math.PI * (t * 1.6 + 0.15));

    for (let b = 0; b < bins; b++) {
      const k = b / (bins - 1);

      let energy = 16 + 150 * Math.exp(-3.6 * k);

      energy += 95 * gauss(b, F1, 3.0);
      energy += 80 * gauss(b, F2, 4.0);
      energy += 55 * gauss(b, F3, 4.5);

      if (!isFricative) {
        const harmonicStrength = 55 * Math.exp(-2.2 * k);
        const distToHarm = Math.abs((b % Math.max(1, pitch)) - pitch / 2) / (pitch / 2);
        const harmonic = harmonicStrength * Math.exp(-8 * distToHarm * distToHarm);
        energy += harmonic;
      }

      if (isFricative) {
        energy += 95 * Math.pow(k, 1.7) + 30 * (Math.random() - 0.5);
      }

      if (isPause) {
        energy = 8 + 18 * Math.random();
      } else {
        energy += 10 * (Math.random() - 0.5);
      }

      const v = clamp(Math.round(energy), 0, 255);
      arr[f * bins + b] = v;
    }
  }

  return arr;
}


export async function fetchSpectrogramMock(): Promise<SpectrogramResponse> {
  await new Promise((r) => setTimeout(r, 250));

  const frames = 1200;
  const melBins = 80;

  return {
    frames,
    melBins,
    hopLength: 160,
    sampleRate: 16000,
    mel: genMel(frames, melBins),

    segments: [
      { id: "em1", label: "em1", startFrame: 20, endFrame: 320 },
      { id: "em2", label: "em2", startFrame: 320, endFrame: 760 },
      { id: "em3", label: "em3", startFrame: 760, endFrame: 1120 },
    ],

    mainEmotion: "neutral",

    features: {
      columns: ["ср", "дисперс", "min", "max"],
      rows: [
        { name: "BP", values: [0.12, 0.04, -0.3, 0.7] },
        { name: "Ch", values: [1.8, 0.31, 1.2, 2.4] },
        { name: "ZH", values: [220, 54, 140, 310] },
        { name: "AC", values: ["ok", "—", "—", "—"] },
        { name: "PR", values: [0.66, 0.09, 0.4, 0.82] },
      ],
    },
  };
}
