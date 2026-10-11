// Bruitages des Ombres de la Taverne, synthétisés en direct (Web Audio) : aucun fichier.
//   cloche  : cloche de taverne (partiels inharmoniques qui s'éteignent lentement)
//   glas    : cloche grave pour un mort
//   luth    : accord pincé (cordes pincées : dent de scie filtrée qui s'éteint vite)
//   fiole   : glouglou (bulles = sinus qui montent, en rafale)
//   epee    : lame tirée du fourreau (bruit aigu + partiels métalliques)
//   papier  : carte retournée / bulletin (souffle filtré très court)
//   tic     : seconde qui tombe (10 dernières secondes)
//   souffle : bascule de phase (balayage de bruit)
// L'ambiance de fond (feu de taverne le jour, vent et loup la nuit) passe par AmbianceSonore.

export type Bruitage = "cloche" | "glas" | "luth" | "fiole" | "epee" | "papier" | "tic" | "souffle" | "victoire";

export class OmbresSon {
  private ctx: AudioContext | null = null;
  private sortie: GainNode | null = null;
  private vol = 0.6;

  private pret() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.sortie = this.ctx.createGain();
      this.sortie.gain.value = this.vol;
      this.sortie.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return { ctx: this.ctx, sortie: this.sortie! };
  }

  volume(v: number) {
    this.vol = v;
    if (this.ctx && this.sortie) this.sortie.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
  }

  private bruit(ctx: AudioContext, duree: number) {
    const n = Math.ceil(ctx.sampleRate * duree);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  private partiel(f: number, v: number, duree: number, debut = 0, type: OscillatorType = "sine") {
    const { ctx, sortie } = this.pret();
    const t = ctx.currentTime + debut;
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g).connect(sortie);
    o.start(t); o.stop(t + duree + 0.05);
  }

  private cloche(base: number, v: number, duree: number, debut = 0) {
    // rapports de partiels d'une cloche (hum, prime, tierce mineure, quinte, octave…)
    for (const [r, a, k] of [[0.5, 0.5, 1], [1, 1, 0.8], [1.19, 0.6, 0.55], [1.5, 0.45, 0.45], [2, 0.5, 0.35], [2.74, 0.25, 0.25], [3.76, 0.15, 0.18]]) {
      this.partiel(base * r, v * a, duree * k, debut);
    }
  }

  private pince(f: number, v: number, debut = 0) {
    const { ctx, sortie } = this.pret();
    const t = ctx.currentTime + debut;
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
    lp.frequency.setValueAtTime(f * 8, t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(lp).connect(g).connect(sortie);
    o.start(t); o.stop(t + 1.9);
  }

  private salve(f: number, q: number, v: number, duree: number, debut = 0, fin?: number) {
    const { ctx, sortie } = this.pret();
    const t = ctx.currentTime + debut;
    const src = this.bruit(ctx, duree + 0.05);
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = q;
    bp.frequency.setValueAtTime(f, t);
    if (fin) bp.frequency.exponentialRampToValueAtTime(fin, t + duree);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + Math.min(0.02, duree / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    src.connect(bp).connect(g).connect(sortie);
    src.start(t); src.stop(t + duree + 0.05);
  }

  jouer(b: Bruitage) {
    try {
      switch (b) {
        case "cloche": this.cloche(620, 0.14, 3.2); this.cloche(620, 0.1, 3, 0.9); break;
        case "glas": this.cloche(196, 0.22, 5.5); break;
        case "luth": [196, 247, 294, 392].forEach((f, i) => this.pince(f, 0.09, i * 0.06)); break;
        case "victoire":
          [262, 330, 392, 523].forEach((f, i) => this.pince(f, 0.1, i * 0.09));
          [392, 494, 587, 784].forEach((f, i) => this.pince(f, 0.09, 0.6 + i * 0.07));
          this.cloche(523, 0.06, 3, 0.6);
          break;
        case "fiole":
          for (let i = 0; i < 7; i++) {
            const { ctx, sortie } = this.pret();
            const t = ctx.currentTime + i * (0.07 + Math.random() * 0.06);
            const o = ctx.createOscillator(); const g = ctx.createGain();
            const f0 = 260 + Math.random() * 220;
            o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f0 * 2.6, t + 0.06);
            g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
            o.connect(g).connect(sortie); o.start(t); o.stop(t + 0.1);
          }
          break;
        case "epee":
          this.salve(5200, 0.8, 0.22, 0.55, 0, 2600);
          for (const [f, v] of [[2210, 0.05], [3720, 0.04], [5130, 0.03]]) this.partiel(f, v, 1.1, 0.08);
          break;
        case "papier": this.salve(2400, 0.9, 0.18, 0.13); this.salve(3800, 1.2, 0.08, 0.08, 0.06); break;
        case "tic": this.partiel(1800, 0.06, 0.05, 0, "triangle"); break;
        case "souffle": this.salve(300, 0.6, 0.18, 1.6, 0, 2200); break;
      }
    } catch {
      /* contexte audio indisponible : on reste muet */
    }
  }

  fermer() {
    this.ctx?.close();
    this.ctx = null;
  }
}
