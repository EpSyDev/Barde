// Bruitages des Flottes Royales, synthétisés en direct (Web Audio) : aucun fichier audio.
//   canon    : détonation (bruit filtré bref + coup sourd qui chute en fréquence)
//   gerbe    : boulet à l'eau (souffle filtré qui se referme)
//   impact   : coque touchée (craquement de bois : rafale de clics filtrés)
//   choc     : éperonnage (coup de bois grave)
//   naufrage : grondement bas et bulles
//   cloche   : cloche de quart (nouvelle manche)
//   verrou   : ordres verrouillés (deux notes montantes)
//   tic      : dernières secondes du sablier
//   victoire / defaite : courte fanfare / phrase descendante
// L'ambiance (houle, plus forte par tempête) a son propre volume. Tout est désactivé par
// défaut ; le contexte audio ne naît qu'au premier son voulu (geste de l'utilisateur).

export type BruitFlotte = "canon" | "gerbe" | "impact" | "choc" | "naufrage" | "cloche" | "verrou" | "tic" | "victoire" | "defaite";

export class FlotteSon {
  private ctx: AudioContext | null = null;
  private effets: GainNode | null = null;
  private fond: GainNode | null = null;
  private houle: { src: AudioBufferSourceNode; filtre: BiquadFilterNode } | null = null;
  private volEffets = 0.6;
  private volFond = 0.3;
  private bruitBlanc: AudioBuffer | null = null;

  private pret() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.effets = this.ctx.createGain();
      this.effets.gain.value = this.volEffets;
      this.effets.connect(this.ctx.destination);
      this.fond = this.ctx.createGain();
      this.fond.gain.value = 0;
      this.fond.connect(this.ctx.destination);
      const n = this.ctx.sampleRate * 2;
      this.bruitBlanc = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = this.bruitBlanc.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return { ctx: this.ctx, sortie: this.effets! };
  }

  volumes(effets: number, fond: number) {
    this.volEffets = effets;
    this.volFond = fond;
    if (this.ctx) {
      this.effets!.gain.setTargetAtTime(effets, this.ctx.currentTime, 0.1);
      if (this.houle) this.fond!.gain.setTargetAtTime(fond, this.ctx.currentTime, 0.4);
    }
  }

  private bruit(duree: number, debut: number, filtre: BiquadFilterType, f0: number, f1: number, v: number, q = 0.8) {
    const { ctx, sortie } = this.pret();
    const t = ctx.currentTime + debut;
    const src = ctx.createBufferSource();
    src.buffer = this.bruitBlanc;
    const fl = ctx.createBiquadFilter();
    fl.type = filtre;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duree);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    src.connect(fl).connect(g).connect(sortie);
    src.start(t, Math.random());
    src.stop(t + duree + 0.05);
  }

  private ton(f0: number, f1: number, v: number, duree: number, debut = 0, type: OscillatorType = "sine") {
    const { ctx, sortie } = this.pret();
    const t = ctx.currentTime + debut;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + duree);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
    o.connect(g).connect(sortie);
    o.start(t);
    o.stop(t + duree + 0.05);
  }

  /** Joue un bruitage, éventuellement décalé (synchronisé sur l'animation de la manche). */
  jouer(b: BruitFlotte, delai = 0) {
    const d = Math.max(0, delai);
    switch (b) {
      case "canon":
        this.bruit(0.5, d, "lowpass", 2400, 180, 0.9);
        this.ton(120, 38, 0.8, 0.45, d);
        break;
      case "gerbe":
        this.bruit(0.7, d, "bandpass", 1800, 500, 0.35, 0.6);
        this.bruit(0.25, d, "highpass", 3000, 5000, 0.12);
        break;
      case "impact":
        for (let i = 0; i < 6; i++) this.bruit(0.06, d + i * 0.025 + Math.random() * 0.02, "bandpass", 900 + Math.random() * 900, 400, 0.35, 3);
        this.ton(90, 50, 0.5, 0.3, d);
        break;
      case "choc":
        this.ton(140, 70, 0.6, 0.28, d, "triangle");
        this.bruit(0.15, d, "lowpass", 900, 200, 0.4);
        break;
      case "naufrage":
        this.ton(70, 35, 0.6, 1.8, d);
        for (let i = 0; i < 8; i++) this.ton(300 + Math.random() * 500, 900 + Math.random() * 600, 0.06, 0.09, d + 0.4 + i * 0.12);
        break;
      case "cloche":
        for (const [r, a, k] of [[1, 0.5, 1], [2.01, 0.25, 0.6], [2.76, 0.15, 0.4], [5.4, 0.06, 0.25]]) this.ton(660 * r, 660 * r, a * 0.5, 1.6 * k, d);
        break;
      case "verrou":
        this.ton(520, 520, 0.18, 0.12, d, "triangle");
        this.ton(780, 780, 0.18, 0.18, d + 0.09, "triangle");
        break;
      case "tic":
        this.ton(1500, 1500, 0.08, 0.04, d, "square");
        break;
      case "victoire":
        [523, 659, 784, 1047].forEach((f, i) => this.ton(f, f, 0.22, i === 3 ? 1.1 : 0.22, d + i * 0.16, "triangle"));
        break;
      case "defaite":
        [392, 349, 311, 262].forEach((f, i) => this.ton(f, f * 0.98, 0.2, i === 3 ? 1.2 : 0.3, d + i * 0.24, "sine"));
        break;
    }
  }

  /** Houle de fond : bruit filtré, lentement modulé ; plus forte et plus claire par gros temps. */
  ambiance(active: boolean, force = 0.5) {
    if (!active) {
      if (this.houle && this.ctx) {
        this.fond!.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
      }
      return;
    }
    const { ctx } = this.pret();
    if (!this.houle) {
      const src = ctx.createBufferSource();
      src.buffer = this.bruitBlanc;
      src.loop = true;
      const filtre = ctx.createBiquadFilter();
      filtre.type = "lowpass";
      filtre.frequency.value = 500;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.12;
      const prof = ctx.createGain();
      prof.gain.value = 220;
      lfo.connect(prof).connect(filtre.frequency);
      src.connect(filtre).connect(this.fond!);
      src.start();
      lfo.start();
      this.houle = { src, filtre };
    }
    this.houle.filtre.frequency.setTargetAtTime(380 + force * 700, ctx.currentTime, 1.5);
    this.fond!.gain.setTargetAtTime(this.volFond * (0.5 + force * 0.8), ctx.currentTime, 0.8);
  }

  fermer() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.houle = null;
  }
}
