import { useEffect, useMemo, useState } from "react";
import { clsx } from "clsx";

/** What Dashie is doing. Each mood rotates through its own set of generated scenes. */
export type Mood = "idle" | "hello" | "building" | "connecting" | "refreshing" | "trouble" | "waiting";

const SCENES: Record<Mood, string[]> = {
  hello: ["dashy-wave", "scene-hello", "scene-coffee", "scene-read"],
  idle: ["scene-think", "scene-read", "scene-coffee", "dashy", "scene-hello"],
  building: ["dashy-building", "scene-research", "scene-pour", "scene-stack", "scene-paint", "scene-laptop", "scene-measure", "scene-juggle"],
  connecting: ["scene-plug", "scene-key", "scene-wait"],
  waiting: ["scene-wait", "scene-think", "scene-coffee"],
  refreshing: ["scene-water", "scene-spin", "scene-pour", "scene-research"],
  trouble: ["scene-fix", "dashy-worried"],
};

/** Short captions that rotate with the building scenes so progress feels alive. */
export const BUILD_CAPTIONS: Record<string, string> = {
  "dashy-building": "Laying the foundations",
  "scene-research": "Looking closely at your data",
  "scene-pour": "Pouring in the numbers",
  "scene-stack": "Stacking up the charts",
  "scene-paint": "Painting the layout",
  "scene-laptop": "Writing the page",
  "scene-measure": "Lining everything up",
  "scene-juggle": "Juggling the details",
};

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Crossfades between scenes on a timer. Two stacked layers: the incoming scene pops in with a small spring
 * (scale .94 → 1) while the outgoing one fades. Images are preloaded so swaps never flash.
 */
export function LiveMascot({
  mood,
  size = 180,
  interval = 2600,
  className,
  onScene,
}: {
  mood: Mood;
  size?: number;
  interval?: number;
  className?: string;
  onScene?: (scene: string) => void;
}) {
  const scenes = SCENES[mood];
  const start = useMemo(() => Math.floor(Math.random() * scenes.length), [scenes]);
  const [i, setI] = useState(start);
  const [prev, setPrev] = useState<number | null>(null);

  useEffect(() => {
    for (const s of scenes) {
      const img = new Image();
      img.src = `dash://brand/${s}.png`;
    }
    setI(start);
    setPrev(null);
  }, [scenes, start]);

  useEffect(() => {
    onScene?.(scenes[i % scenes.length]!);
  }, [i, scenes, onScene]);

  useEffect(() => {
    if (scenes.length < 2 || reduced()) return;
    const t = setInterval(() => {
      setI((cur) => {
        setPrev(cur);
        return (cur + 1) % scenes.length;
      });
    }, interval);
    return () => clearInterval(t);
  }, [scenes, interval]);

  const cur = scenes[i % scenes.length]!;
  const old = prev !== null ? scenes[prev % scenes.length] : null;

  return (
    <div className={clsx("relative select-none", !reduced() && "bob", className)} style={{ width: size, height: size }} aria-hidden>
      {old && old !== cur && (
        <img key={`o-${prev}-${i}`} src={`dash://brand/${old}.png`} alt="" draggable={false} className="mascot-out absolute inset-0 h-full w-full object-contain" />
      )}
      <img key={`c-${i}`} src={`dash://brand/${cur}.png`} alt="" draggable={false} className="mascot-in absolute inset-0 h-full w-full object-contain" />
    </div>
  );
}
