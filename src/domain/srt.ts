export type CaptionShot = {
  id: string;
  durationSeconds: number;
  captionText: string;
};

export function timestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error("seconds must be a non-negative finite number");
  }

  const ms = Math.round(seconds * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(secs).padStart(2, "0")
  ].join(":") + `,${String(millis).padStart(3, "0")}`;
}

export function shotsToSrt(shots: CaptionShot[]): string {
  let cursor = 0;
  const blocks = shots.map((shot, index) => {
    if (!Number.isFinite(shot.durationSeconds) || shot.durationSeconds <= 0) {
      throw new Error(`shot ${shot.id} durationSeconds must be a positive finite number`);
    }

    const start = cursor;
    const end = cursor + shot.durationSeconds;
    cursor = end;
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${shot.captionText}`;
  });

  return `${blocks.join("\n\n")}\n`;
}
