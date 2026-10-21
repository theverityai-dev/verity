import captions from "../../content/captions.json";

/**
 * Caption lines, built once by scripts/audio/build_timeline.py (the same lines are exported as
 * deliverables/captions.srt and .vtt), in the script's words and timed to the recorded voice.
 */
export const captionLines = captions as Array<{ start: number; end: number; text: string }>;
