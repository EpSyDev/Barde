// Ambiances sonores du plateau, synthétisées en direct (Web Audio) : aucun fichier,
// aucun droit d'auteur, quelques Ko de code. Chaque ambiance = des « couches » :
//   feu      : souffle grave + crépitements (salves de bruit très courtes)
//   pluie    : bruit filtré + gouttes isolées
//   vent     : bruit passe-bande dont la fréquence et le volume ondulent
//   oiseaux  : petits glissandos sinusoïdaux aléatoires
//   gouttes  : « ploc » d'eau dans une crypte (sinus qui chute + écho)
//   bourdon  : drone grave désaccordé (crypte)
//   foule    : murmure de taverne (bruit filtré, volume qui respire) + chopes qui trinquent
// Le navigateur exige un geste de l'utilisateur avant de jouer du son : le plateau ne
// démarre l'ambiance qu'après le clic sur 🔊.

export type Son = "aucun" | "taverne" | "crypte" | "foret" | "camp" | "pluie";

const RECETTES: Record<Exclude<Son, "aucun">, string[]> = {
  taverne: ["foule", "feu"],
  crypte: ["bourdon", "gouttes", "vent-faible"],
  foret: ["vent", "oiseaux"],
  camp: ["feu", "vent-faible", "grillons"],
  pluie: ["pluie", "vent-faible"],
};

export class AmbianceSonore {
  private ctx: AudioContext | null = null;
  private maitre: GainNode | null = null;
  private arrets: (() => void)[] = [];
  private courant: Son = "aucun";
  private vol = 0.5;

  private bruit(ctx: AudioContext, couleur: "blanc" | "rose" | "brun" = "blanc") {
    const n = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (couleur === "brun") { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
      else if (couleur === "rose") {
        p0 = 0.99765 * p0 + w * 0.099; p1 = 0.963 * p1 + w * 0.2965; p2 = 0.57 * p2 + w * 1.0526;
        d[i] = (p0 + p1 + p2 + w * 0.1848) * 0.11;
      } else d[i] = w;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    return src;
  }

  /** Répète `f` à intervalles aléatoires tant que l'ambiance tourne. */
  private aleatoire(min: number, max: number, f: () => void) {
    let t: ReturnType<typeof setTimeout>;
    const boucle = () => {
      f();
      t = setTimeout(boucle, min + Math.random() * (max - min));
    };
    t = setTimeout(boucle, Math.random() * max);
    this.arrets.push(() => clearTimeout(t));
  }

  private couche(nom: string) {
    const ctx = this.ctx!, sortie = this.maitre!;
    const gain = (v: number) => { const g = ctx.createGain(); g.gain.value = v; g.connect(sortie); return g; };
    const filtre = (type: BiquadFilterType, f: number, q = 0.7) => {
      const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
    };
    const lfo = (freq: number, ampl: number, cible: AudioParam) => {
      const o = ctx.createOscillator(); o.frequency.value = freq;
      const g = ctx.createGain(); g.gain.value = ampl;
      o.connect(g).connect(cible); o.start();
      this.arrets.push(() => o.stop());
    };
    const continu = (src: AudioBufferSourceNode, ...noeuds: AudioNode[]) => {
      let n: AudioNode = src;
      for (const x of noeuds) n = n.connect(x);
      src.start();
      this.arrets.push(() => src.stop());
    };
    const ping = (freq: number, fin: number, duree: number, v: number, type: OscillatorType = "sine") => {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.frequency.exponentialRampToValueAtTime(fin, t + duree);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      o.connect(g).connect(sortie);
      o.start(t); o.stop(t + duree + 0.05);
      return g;
    };
    const salve = (f: number, duree: number, v: number) => {
      const t = ctx.currentTime;
      const src = this.bruit(ctx);
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + duree);
      src.connect(filtre("bandpass", f, 1.2)).connect(g).connect(sortie);
      src.start(t, Math.random() * 2); src.stop(t + duree + 0.02);
    };

    switch (nom) {
      case "feu": {
        continu(this.bruit(ctx, "brun"), filtre("lowpass", 420), gain(0.5));
        this.aleatoire(40, 260, () => salve(1800 + Math.random() * 3000, 0.02 + Math.random() * 0.05, 0.25 + Math.random() * 0.35));
        break;
      }
      case "pluie": {
        continu(this.bruit(ctx, "rose"), filtre("highpass", 900), filtre("lowpass", 7000), gain(0.35));
        this.aleatoire(30, 160, () => salve(3000 + Math.random() * 4000, 0.015, 0.12));
        break;
      }
      case "vent":
      case "vent-faible": {
        const bp = filtre("bandpass", 500, 0.8);
        const g = gain(nom === "vent" ? 0.45 : 0.18);
        continu(this.bruit(ctx, "rose"), bp, g);
        lfo(0.07, 250, bp.frequency);
        lfo(0.11, nom === "vent" ? 0.2 : 0.08, g.gain);
        break;
      }
      case "oiseaux": {
        this.aleatoire(1500, 6000, () => {
          const base = 2200 + Math.random() * 2200;
          const n = 1 + Math.floor(Math.random() * 4);
          for (let i = 0; i < n; i++)
            setTimeout(() => ping(base, base * (0.75 + Math.random() * 0.5), 0.09 + Math.random() * 0.08, 0.06), i * 130);
        });
        break;
      }
      case "grillons": {
        this.aleatoire(700, 2400, () => {
          for (let i = 0; i < 3; i++) setTimeout(() => ping(4400, 4300, 0.04, 0.025, "triangle"), i * 70);
        });
        break;
      }
      case "gouttes": {
        const echo = ctx.createDelay(1); echo.delayTime.value = 0.32;
        const fb = ctx.createGain(); fb.gain.value = 0.35;
        echo.connect(fb).connect(echo);
        echo.connect(gain(0.6));
        this.aleatoire(900, 4200, () => {
          const g = ping(900 + Math.random() * 900, 250, 0.18, 0.18);
          g.connect(echo);
        });
        break;
      }
      case "bourdon": {
        const g = gain(0.12);
        const lp = filtre("lowpass", 240);
        lp.connect(g);
        for (const f of [55, 58.3, 82.4]) {
          const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
          o.connect(lp); o.start();
          this.arrets.push(() => o.stop());
        }
        lfo(0.05, 0.05, g.gain);
        break;
      }
      case "foule": {
        const bp = filtre("bandpass", 600, 0.6);
        const g = gain(0.28);
        continu(this.bruit(ctx, "rose"), bp, g);
        lfo(0.23, 0.08, g.gain);
        lfo(0.13, 160, bp.frequency);
        this.aleatoire(2500, 9000, () => {            // chopes qui trinquent
          ping(2600 + Math.random() * 800, 2400, 0.25, 0.05, "triangle");
          setTimeout(() => ping(3100 + Math.random() * 600, 2900, 0.2, 0.04, "triangle"), 60);
        });
        this.aleatoire(6000, 16000, () => salve(300, 0.6, 0.1));   // éclat de rire lointain
        break;
      }
    }
  }

  /** Lance (ou change) l'ambiance. À appeler après un geste de l'utilisateur. */
  jouer(son: Son) {
    if (son === this.courant && this.ctx) return;
    this.arreter();
    this.courant = son;
    if (son === "aucun") return;
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.maitre = this.ctx.createGain();
      this.maitre.connect(this.ctx.destination);
    }
    this.ctx.resume();
    const t = this.ctx.currentTime;
    this.maitre!.gain.cancelScheduledValues(t);
    this.maitre!.gain.setValueAtTime(0, t);
    this.maitre!.gain.linearRampToValueAtTime(this.vol, t + 2.5);    // fondu d'entrée
    for (const c of RECETTES[son]) this.couche(c);
  }

  volume(v: number) {
    this.vol = v;
    if (this.ctx && this.maitre) this.maitre.gain.setTargetAtTime(v, this.ctx.currentTime, 0.2);
  }

  arreter() {
    this.arrets.forEach((f) => { try { f(); } catch { /* déjà arrêté */ } });
    this.arrets = [];
    this.courant = "aucun";
  }

  fermer() {
    this.arreter();
    this.ctx?.close();
    this.ctx = null;
  }
}
