"use client";

// La carte marine : une toile, un moteur de rendu (rendu.ts), et les gestes — clic/tap pour
// agir, glisser pour déplacer la vue, molette ou pincement pour zoomer. Aucune logique de
// jeu ici : un clic remonte simplement la case visée.

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Cell } from "@/lib/flotte";
import { Rendu, type Scene } from "./rendu";

export default function Carte({ scene, rendu, surCase, surSurvol, etiquette }: {
  scene: Scene;
  rendu: MutableRefObject<Rendu | null>;
  surCase: (c: Cell) => void;
  surSurvol: (c: Cell | null) => void;
  etiquette: string;
}) {
  const toile = useRef<HTMLCanvasElement>(null);
  const boite = useRef<HTMLDivElement>(null);
  const rappels = useRef({ surCase, surSurvol });
  rappels.current = { surCase, surSurvol };

  useEffect(() => {
    const r = new Rendu(toile.current!);
    rendu.current = r;
    const ro = new ResizeObserver(([e]) => r.redimensionner(e.contentRect.width, e.contentRect.height));
    ro.observe(boite.current!);
    return () => { ro.disconnect(); r.detruire(); rendu.current = null; };
  }, [rendu]);

  useEffect(() => {
    rendu.current?.definir(scene);
  }, [scene, rendu]);

  useEffect(() => {
    const el = toile.current!;
    const pointeurs = new Map<number, { x: number; y: number }>();
    let depart: { x: number; y: number } | null = null;
    let glisse = false;
    let pince = 0;
    const local = (e: PointerEvent | WheelEvent) => {
      const b = el.getBoundingClientRect();
      return { x: e.clientX - b.left, y: e.clientY - b.top };
    };
    const bas = (e: PointerEvent) => {
      el.setPointerCapture(e.pointerId);
      pointeurs.set(e.pointerId, local(e));
      if (pointeurs.size === 1) { depart = local(e); glisse = false; }
      if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()];
        pince = Math.hypot(a.x - b.x, a.y - b.y);
        glisse = true;
      }
    };
    const bouge = (e: PointerEvent) => {
      const p = local(e);
      const avant = pointeurs.get(e.pointerId);
      if (!avant) {
        if (e.pointerType === "mouse") rappels.current.surSurvol(rendu.current?.caseAuPoint(p.x, p.y) ?? null);
        return;
      }
      pointeurs.set(e.pointerId, p);
      if (pointeurs.size === 2) {
        const [a, b] = [...pointeurs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pince > 0) rendu.current?.zoomer(d / pince, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pince = d;
        return;
      }
      if (depart && Math.hypot(p.x - depart.x, p.y - depart.y) > 6) glisse = true;
      if (glisse) rendu.current?.deplacer(p.x - avant.x, p.y - avant.y);
      else if (e.pointerType === "mouse") rappels.current.surSurvol(rendu.current?.caseAuPoint(p.x, p.y) ?? null);
    };
    const haut = (e: PointerEvent) => {
      const p = local(e);
      const seul = pointeurs.size === 1;
      pointeurs.delete(e.pointerId);
      if (pointeurs.size < 2) pince = 0;
      if (seul && !glisse) {
        const c = rendu.current?.caseAuPoint(p.x, p.y);
        if (c) rappels.current.surCase(c);
      }
      if (!pointeurs.size) depart = null;
    };
    const roulette = (e: WheelEvent) => {
      e.preventDefault();
      const p = local(e);
      rendu.current?.zoomer(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    };
    const sortie = () => rappels.current.surSurvol(null);
    el.addEventListener("pointerdown", bas);
    el.addEventListener("pointermove", bouge);
    el.addEventListener("pointerup", haut);
    el.addEventListener("pointercancel", haut);
    el.addEventListener("pointerleave", sortie);
    el.addEventListener("wheel", roulette, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", bas);
      el.removeEventListener("pointermove", bouge);
      el.removeEventListener("pointerup", haut);
      el.removeEventListener("pointercancel", haut);
      el.removeEventListener("pointerleave", sortie);
      el.removeEventListener("wheel", roulette);
    };
  }, [rendu]);

  return (
    <div ref={boite} className="fl-carte">
      <canvas ref={toile} role="img" aria-label={etiquette} />
    </div>
  );
}
