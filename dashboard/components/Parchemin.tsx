// État vide illustré : un petit parchemin roulé haut et bas, médaillon enluminé à
// l'émail du quartier, titre et une ligne d'explication. Remplace les « Aucun… » secs.
import Icon, { type IconName } from "@/components/Icon";

export default function Parchemin({
  icone = "parchemin",
  titre,
  children,
}: {
  icone?: IconName;
  titre?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="parchemin-vide" role="status">
      <div className="parchemin-corps">
        <span className="parchemin-medaillon">
          <Icon name={icone} />
        </span>
        {titre && <p className="parchemin-titre">{titre}</p>}
        {children && <p className="parchemin-texte">{children}</p>}
        <span className="parchemin-fleuron" aria-hidden="true">❦</span>
      </div>
    </div>
  );
}
