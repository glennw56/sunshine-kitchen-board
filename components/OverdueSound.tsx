"use client";

import { useEffect, useRef } from "react";

/** Audible beep while overdue tickets are on an open board. */
export function OverdueSound({ count }: { count: number }) {
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (count <= 0) return;
    let timer = 0;
    const beep = () => {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      if (!contextRef.current) contextRef.current = new AudioCtx();
      const ctx = contextRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    };
    const unlock = () => beep();
    window.addEventListener("pointerdown", unlock, { once: true });
    beep();
    timer = window.setInterval(beep, 4000);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.clearInterval(timer);
    };
  }, [count]);

  return <span data-testid="overdue-sound" data-overdue={count} hidden />;
}
