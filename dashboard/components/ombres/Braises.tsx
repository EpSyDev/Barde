"use client";

// Fond animé : braises qui montent du feu le jour, poussière de lune violette la nuit.
// Un seul canvas, particules recyclées, s'arrête quand l'onglet est caché ; mouvement
// réduit si le système le demande.

import { useEffect, useRef } from "react";

type P = { x: number; y: number; vx: number; vy: number; r: number; vie: number; max: number; phase: number };

export default function Braises({ nuit }: { nuit: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const nuitRef = useRef(nuit);
  nuitRef.current = nuit;

  useEffect(() => {
    const cv = ref.current!;
    const ctx = cv.getContext("2d")!;
    const reduit = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let l = 0, h = 0, raf = 0, dernier = performance.now();
    let mix = nuitRef.current ? 1 : 0;           // 0 = jour, 1 = nuit (fondu)
    const ps: P[] = [];

    const taille = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      l = cv.clientWidth; h = cv.clientHeight;
      cv.width = l * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const naitre = (p?: P, debut = false): P => {
      const q = p || ({} as P);
      q.x = Math.random() * l;
      q.y = debut ? Math.random() * h : h + 10;
      q.vx = (Math.random() - 0.5) * 12;
      q.vy = -(14 + Math.random() * 36);
      q.r = 0.8 + Math.random() * 2.2;
      q.max = 5 + Math.random() * 9;
      q.vie = debut ? Math.random() * q.max : 0;
      q.phase = Math.random() * Math.PI * 2;
      return q;
    };
    const nb = () => Math.round(Math.min(110, (l * h) / 14000) * (reduit ? 0.3 : 1));

    const image = (t: number) => {
      const dt = Math.min(0.05, (t - dernier) / 1000);
      dernier = t;
      mix += ((nuitRef.current ? 1 : 0) - mix) * Math.min(1, dt * 0.8);
      while (ps.length < nb()) ps.push(naitre(undefined, true));
      ps.length = Math.min(ps.length, nb());
      ctx.clearRect(0, 0, l, h);
      ctx.globalCompositeOperation = "lighter";
      const vitesse = 1 - mix * 0.55;
      for (const p of ps) {
        p.vie += dt;
        if (p.vie > p.max || p.y < -20) naitre(p);
        p.phase += dt * (1.5 + mix);
        p.x += (p.vx + Math.sin(p.phase) * (8 + mix * 14)) * dt;
        p.y += p.vy * dt * vitesse;
        const a = Math.sin((p.vie / p.max) * Math.PI);           // apparaît puis s'éteint
        const scint = 0.65 + 0.35 * Math.sin(p.phase * 3.1);
        // jour : braise orangée ; nuit : poussière de lune violette, plus grosse et plus douce
        const r = p.r * (1 + mix * 0.8);
        const c1 = [255 - mix * 85, 170 - mix * 30 + 20 * scint, 70 + mix * 185];
        const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 5);
        halo.addColorStop(0, `rgba(${c1[0]},${c1[1]},${c1[2]},${0.55 * a * scint})`);
        halo.addColorStop(1, `rgba(${c1[0]},${c1[1]},${c1[2]},0)`);
        ctx.fillStyle = halo;
        ctx.fillRect(p.x - r * 5, p.y - r * 5, r * 10, r * 10);
        ctx.fillStyle = `rgba(255,${235 - mix * 20},${200 + mix * 55},${0.9 * a * scint})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      if (!document.hidden) raf = requestAnimationFrame(image);
    };
    const visibilite = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) { dernier = performance.now(); raf = requestAnimationFrame(image); }
    };
    taille();
    window.addEventListener("resize", taille);
    document.addEventListener("visibilitychange", visibilite);
    raf = requestAnimationFrame(image);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", taille);
      document.removeEventListener("visibilitychange", visibilite);
    };
  }, []);

  return <canvas ref={ref} className="om-braises" aria-hidden="true" />;
}
