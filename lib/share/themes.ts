/**
 * Les thèmes de la carte de partage (specs §4.15, issue #263) — LE fichier de
 * coordonnées : chaque zone de chaque thème, MESURÉE au pixel sur les fonds
 * vierges dans le labo de calage `docs/protos/proto-share-cards.html`
 * (superpositions, mode ?iso=1, planches-spécimens pour les polices).
 *
 * Tout nouveau thème se calibre D'ABORD au banc de superposition sur son modèle
 * rempli (méthode dans le README des templates), puis se porte ici. Les 11 thèmes
 * y sont passés (03/10/2026).
 * L'espace de coordonnées est celui des fonds : 1024×1536 (2:3). Les corps
 * sont en px de cet espace (le proto parlait en cqw : 1 cqw = 10,24 px).
 *
 * Règles typographiques apprises au calage (et non négociables) :
 * - les valeurs RÉPÉTÉES d'un même bloc (6 objectifs, 7 compteurs) partagent
 *   un corps FIXE — jamais de rétrécissement individuel ;
 * - le rétrécissement automatique (maxWidth) est réservé aux instances
 *   uniques : pseudo, date, score — « +102,5 » rentre toujours dans son
 *   cartouche ;
 * - la zone photo est un MASQUE de forme (ellipse au bord INTÉRIEUR du cadre,
 *   les bordures du thème restent visibles), photo en cover dedans ;
 * - les jauges se remplissent à `min(1, fait/cible)`, dans la boîte mesurée,
 *   avec un retrait (inset) qui respecte le contour dessiné.
 */

export const CARD_WIDTH = 1024;
export const CARD_HEIGHT = 1536;

/**
 * La version des fonds de thème — à bumper à CHAQUE régénération de
 * `public/share/themes/` (fonds et vignettes). Ils sont servis 7 j + 30 j de
 * stale-while-revalidate (`next.config.ts`) sous la même URL : sans version,
 * un appareil dessinerait les données neuves sur l'ancien fond (review #352 :
 * les points par-dessus le barème qui y était incrusté).
 */
export const SHARE_BACKGROUND_VERSION = 2;

/** L'URL servie d'un fichier de fond (fond ou vignette), versionnée. */
export const versionedBackgroundUrl = (path: string): string => `${path}?v=${SHARE_BACKGROUND_VERSION}`;

/** Les polices auto-hébergées (woff2 latin, public/share/fonts/ — RGPD : jamais de hotlink Google). */
export const SHARE_FONTS = {
  "abhaya-libre-400": { family: "Abhaya Libre", weight: 400, italic: false, file: "abhaya-libre-400.woff2" },
  "alegreya-900": { family: "Alegreya", weight: 900, italic: false, file: "alegreya-900.woff2" },
  "aleo-900": { family: "Aleo", weight: 900, italic: false, file: "aleo-900.woff2" },
  "alfa-slab-one": { family: "Alfa Slab One", weight: 400, italic: false, file: "alfa-slab-one-400.woff2" },
  "amaranth-700-italic": { family: "Amaranth", weight: 700, italic: true, file: "amaranth-700-italic.woff2" },
  "anybody-600": { family: "Anybody", weight: 600, italic: false, file: "anybody-600.woff2" },
  "asap-condensed-700": { family: "Asap Condensed", weight: 700, italic: false, file: "asap-condensed-700.woff2" },
  "barlow-800-italic": { family: "Barlow", weight: 800, italic: true, file: "barlow-800-italic.woff2" },
  "barlow-condensed-800": { family: "Barlow Condensed", weight: 800, italic: false, file: "barlow-condensed-800.woff2" },
  "barlow-condensed-800-italic": { family: "Barlow Condensed", weight: 800, italic: true, file: "barlow-condensed-800-italic.woff2" },
  "barlow-condensed-900-italic": { family: "Barlow Condensed", weight: 900, italic: true, file: "barlow-condensed-900-italic.woff2" },
  "bebas-neue-400": { family: "Bebas Neue", weight: 400, italic: false, file: "bebas-neue-400.woff2" },
  "big-shoulders-stencil-900": { family: "Big Shoulders Stencil", weight: 900, italic: false, file: "big-shoulders-stencil-900.woff2" },
  "caudex-700": { family: "Caudex", weight: 700, italic: false, file: "caudex-700.woff2" },
  "cormorant-700": { family: "Cormorant Garamond", weight: 700, italic: false, file: "cormorant-garamond-700.woff2" },
  "courier-prime-400": { family: "Courier Prime", weight: 400, italic: false, file: "courier-prime-400.woff2" },
  "eb-garamond-500": { family: "EB Garamond", weight: 500, italic: false, file: "eb-garamond-500.woff2" },
  "eb-garamond-600": { family: "EB Garamond", weight: 600, italic: false, file: "eb-garamond-600.woff2" },
  "eb-garamond-800": { family: "EB Garamond", weight: 800, italic: false, file: "eb-garamond-800.woff2" },
  "exo-2-800-italic": { family: "Exo 2", weight: 800, italic: true, file: "exo-2-800-italic.woff2" },
  "exo-2-900": { family: "Exo 2", weight: 900, italic: false, file: "exo-2-900.woff2" },
  "finlandica-headline-900-italic": { family: "Finlandica Headline", weight: 900, italic: true, file: "finlandica-headline-900-italic.woff2" },
  "gentium-plus-400": { family: "Gentium Plus", weight: 400, italic: false, file: "gentium-plus-400.woff2" },
  "heebo-600": { family: "Heebo", weight: 600, italic: false, file: "heebo-600.woff2" },
  "heebo-800": { family: "Heebo", weight: 800, italic: false, file: "heebo-800.woff2" },
  knewave: { family: "Knewave", weight: 400, italic: false, file: "knewave-400.woff2" },
  "libre-caslon-text-400": { family: "Libre Caslon Text", weight: 400, italic: false, file: "libre-caslon-text-400.woff2" },
  "literata-700": { family: "Literata", weight: 700, italic: false, file: "literata-700.woff2" },
  "literata-800": { family: "Literata", weight: 800, italic: false, file: "literata-800.woff2" },
  "lora-700": { family: "Lora", weight: 700, italic: false, file: "lora-700.woff2" },
  "mona-sans-800": { family: "Mona Sans", weight: 800, italic: false, file: "mona-sans-800.woff2" },
  "new-rocker-400": { family: "New Rocker", weight: 400, italic: false, file: "new-rocker-400.woff2" },
  "noto-sans-800-italic": { family: "Noto Sans", weight: 800, italic: true, file: "noto-sans-800-italic.woff2" },
  "oswald-500": { family: "Oswald", weight: 500, italic: false, file: "oswald-500.woff2" },
  "oswald-600": { family: "Oswald", weight: 600, italic: false, file: "oswald-600.woff2" },
  "rajdhani-700": { family: "Rajdhani", weight: 700, italic: false, file: "rajdhani-700.woff2" },
  "roboto-700": { family: "Roboto", weight: 700, italic: false, file: "roboto-700.woff2" },
  "roboto-900": { family: "Roboto", weight: 900, italic: false, file: "roboto-900.woff2" },
  "roboto-condensed-900": { family: "Roboto Condensed", weight: 900, italic: false, file: "roboto-condensed-900.woff2" },
  "roboto-slab-700": { family: "Roboto Slab", weight: 700, italic: false, file: "roboto-slab-700.woff2" },
  "saira-condensed-700": { family: "Saira Condensed", weight: 700, italic: false, file: "saira-condensed-700.woff2" },
  "saira-condensed-800": { family: "Saira Condensed", weight: 800, italic: false, file: "saira-condensed-800.woff2" },
  "saira-extra-condensed-800": { family: "Saira Extra Condensed", weight: 800, italic: false, file: "saira-extra-condensed-800.woff2" },
  "sofia-sans-extra-condensed-900-italic": { family: "Sofia Sans Extra Condensed", weight: 900, italic: true, file: "sofia-sans-extra-condensed-900-italic.woff2" },
  "special-elite": { family: "Special Elite", weight: 400, italic: false, file: "special-elite-400.woff2" },
  "tomorrow-700": { family: "Tomorrow", weight: 700, italic: false, file: "tomorrow-700.woff2" },
  "tomorrow-700-italic": { family: "Tomorrow", weight: 700, italic: true, file: "tomorrow-700-italic.woff2" },
} as const;

export type ShareFontKey = keyof typeof SHARE_FONTS;

export type ShareGradient = {
  /** Angle CSS en degrés (0 = vers le haut, 90 = vers la droite). */
  angleDeg: number;
  stops: { at: number; color: string }[];
};

export type ShareTextStyle = {
  font: ShareFontKey;
  /** Corps en px de l'espace 1024×1536. */
  size: number;
  /** Couleur pleine — omise si `gradient`. */
  color?: string;
  gradient?: ShareGradient;
  /** Interlettrage en em (multiplié par `size` au rendu). */
  letterSpacing?: number;
  /** Penché (skewX) en degrés, négatif = vers la droite. */
  skewDeg?: number;
  /** Contour, en px. */
  stroke?: { width: number; color: string };
  /** Ombres portées/halos, en px, dessinées dans l'ordre (la première au fond). */
  shadows?: { dx: number; dy: number; blur: number; color: string }[];
  /**
   * Texte CINTRÉ : rayon en px du cercle (centre sous le texte, arc en dôme)
   * que suivent les glyphes, chacun incliné sur sa tangente — pour un cartouche
   * courbe (la bannière de « Carte au trésor »). Omis = texte droit.
   */
  arcRadius?: number;
  /**
   * Étirement vertical autour de la ligne de base (1 = aucun) — quand les
   * chiffres du fond sont plus hauts que la police la plus proche, à largeur
   * égale (le « +21 » de « Carte au trésor » : 112 px de haut contre 103).
   */
  scaleY?: number;
};

type UniqueTextZone = {
  x: number;
  y: number;
  /** Rétrécissement automatique : le texte plus large que ça se réduit. */
  maxWidth: number;
  style: ShareTextStyle;
};

export type ShareTheme = {
  id: string;
  /** Le nom affiché dans le choix de thème. */
  label: string;
  /** Le fond, sous public/ (1024×1536, WebP). */
  background: string;
  name: UniqueTextZone;
  month: UniqueTextZone;
  score: UniqueTextZone;
  /** Masque photo : ellipse au bord INTÉRIEUR du cadre — ry omis = cercle. */
  avatar: { cx: number; cy: number; rx: number; ry?: number };
  objectives: {
    /** y des 3 lignes de valeurs (col. gauche = Issue/Manga/BD, droite = Comics/Omnibus/Roman). */
    textRows: [number, number, number];
    /** y du CENTRE des 3 jauges. */
    barRows: [number, number, number];
    /** x [début, fin] des boîtes de jauge par colonne. */
    leftBar: [number, number];
    rightBar: [number, number];
    barHeight: number;
    /** Bord droit des valeurs « fait / cible » par colonne. */
    leftValueRight: number;
    rightValueRight: number;
    /** Corps FIXE des 6 valeurs (jamais rétréci). */
    valueStyle: ShareTextStyle;
    gaugeFill: string | ShareGradient;
    gaugeRadius: number;
  };
  table: {
    /** y des 7 lignes (Issue, Manga, BD, Comics, Omnibus, Roman, acheté non lu). */
    rows: [number, number, number, number, number, number, number];
    /** Centre x de la colonne des compteurs. */
    x: number;
    /** Corps FIXE des compteurs. */
    countStyle: ShareTextStyle;
    /**
     * La colonne PTS : les points GAGNÉS par ligne (lectures × barème, malus
     * des achats), sur les mêmes lignes `rows` que les compteurs. Police,
     * corps, interlettrage et encres relevés par superposition sur le barème
     * que les fonds portaient avant (fonds de prod − fonds vierges). Le zéro
     * prend une encre neutre : un « 0 » rouge sur « Titre acheté non lu »
     * annoncerait un malus qui n'existe pas.
     */
    points: {
      /** Centre x de la colonne PTS. */
      x: number;
      /** Corps FIXE ; `color` est l'encre des gains — pleine, jamais un dégradé (l'encre se choisit au signe). */
      style: ShareTextStyle & { color: string; gradient?: never };
      /** L'encre du malus. */
      penaltyColor: string;
      /**
       * L'alignement des valeurs sur `x` — centré par défaut ; certains modèles
       * alignent la colonne à gauche (« +0,5 » et « +1 » partent du même bord).
       */
      align?: "center" | "left" | "right";
      /** Décalage vertical des valeurs PTS sur les lignes `rows` (px) — le modèle les pose parfois hors du centre des compteurs. */
      dy?: number;
      /** L'encre du zéro — par défaut celle des compteurs. */
      zeroColor?: string;
    };
  };
};

export const SHARE_THEMES: readonly ShareTheme[] = [
  // Thèmes 0-9 recalés le 03/10/2026 sur leurs modèles remplis (theme_N.jpeg) :
  // polices criblées sur le catalogue Google, départagées au calque, corps,
  // interlettrage, inclinaison et position mesurés à l'encre du modèle
  // (méthode : README des templates). Les compteurs, sans exemple au modèle,
  // suivent la police de la colonne PTS.
  {
    id: "theme_0",
    label: "Néon",
    background: "/share/themes/theme_0.webp",
    name: {
      x: 524, y: 144, maxWidth: 340,
      style: { font: "exo-2-900", size: 75.5, color: "#ffffff", letterSpacing: 0.07, skewDeg: -13 },
    },
    month: {
      x: 706.5, y: 305, maxWidth: 310,
      style: { font: "roboto-900", size: 21.5, color: "#8f6ac6", letterSpacing: 0.52 },
    },
    score: {
      x: 687.5, y: 403.5, maxWidth: 350,
      style: { font: "exo-2-800-italic", size: 148, gradient: { angleDeg: 105, stops: [{ at: 0.05, color: "#ff45c8" }, { at: 0.45, color: "#7a58f2" }, { at: 0.9, color: "#2bd8d8" }] }, skewDeg: -7 },
    },
    avatar: { cx: 272, cy: 400, rx: 120 },
    objectives: {
      textRows: [668.5, 745.5, 822.5], barRows: [702, 776, 853],
      leftBar: [112, 476], rightBar: [545, 915], barHeight: 16,
      leftValueRight: 476, rightValueRight: 912,
      valueStyle: { font: "heebo-600", size: 24.4, color: "#8f68cc", letterSpacing: 0.05 },
      gaugeFill: { angleDeg: 90, stops: [{ at: 0, color: "#ff4fa8" }, { at: 1, color: "#2ee6a8" }] },
      gaugeRadius: 99,
    },
    table: {
      rows: [1043, 1103, 1163, 1223, 1283, 1341, 1401], x: 565,
      countStyle: { font: "heebo-800", size: 37.3, color: "#eae6f8", letterSpacing: 0.04 },
      points: {
        x: 806.5,
        style: { font: "heebo-800", size: 37.3, color: "#34d5a4", letterSpacing: 0.04 },
        penaltyColor: "#d53761",
      },
    },
  },
  {
    id: "theme_1",
    label: "Dossier confidentiel",
    background: "/share/themes/theme_1.webp",
    name: {
      x: 557, y: 205, maxWidth: 475,
      style: { font: "big-shoulders-stencil-900", size: 86.7, color: "#4a4124", letterSpacing: 0.27 },
    },
    month: {
      x: 735, y: 334.5, maxWidth: 310,
      style: { font: "courier-prime-400", size: 33, color: "#4d412d", letterSpacing: 0.15 },
    },
    score: {
      x: 741, y: 453.5, maxWidth: 330,
      style: { font: "roboto-slab-700", size: 182, color: "#2a2419", letterSpacing: 0.03 },
    },
    avatar: { cx: 306, cy: 452, rx: 154 },
    objectives: {
      textRows: [763.5, 848.5, 931.5], barRows: [800, 884, 966],
      leftBar: [162, 484], rightBar: [556, 893], barHeight: 26,
      leftValueRight: 483, rightValueRight: 893,
      valueStyle: { font: "courier-prime-400", size: 28.7, color: "#4a4236", letterSpacing: -0.19 },
      gaugeFill: "#3f3524d9",
      gaugeRadius: 3,
    },
    table: {
      rows: [1130, 1178, 1222, 1268, 1312, 1358, 1404], x: 595,
      countStyle: { font: "special-elite", size: 25.3, color: "#3a332a", letterSpacing: 0.2 },
      points: {
        x: 784.5, align: "left", dy: 3,
        style: { font: "special-elite", size: 25.3, color: "#3c2c14", letterSpacing: 0.2 },
        penaltyColor: "#763b28",
      },
    },
  },
  {
    id: "theme_2",
    label: "Manga",
    background: "/share/themes/theme_2.webp",
    name: {
      x: 529.5, y: 140.5, maxWidth: 510,
      style: { font: "knewave", size: 118.4, color: "#131110", letterSpacing: 0.06, skewDeg: -3 },
    },
    month: {
      x: 716.5, y: 302, maxWidth: 310,
      style: { font: "bebas-neue-400", size: 33.1, color: "#0e0c0a", letterSpacing: 0.39 },
    },
    score: {
      x: 686, y: 401, maxWidth: 368,
      style: { font: "barlow-condensed-800-italic", size: 234.7, color: "#131110", letterSpacing: 0.03, skewDeg: -9, shadows: [{ dx: 0, dy: 0, blur: 4, color: "#ffffff" }, { dx: 0, dy: 0, blur: 8, color: "#ffffff" }, { dx: 0, dy: 0, blur: 14, color: "#ffffff" }, { dx: 4, dy: 4, blur: 6, color: "#ffffff" }, { dx: -4, dy: 4, blur: 6, color: "#ffffff" }, { dx: 4, dy: -4, blur: 6, color: "#ffffff" }, { dx: -4, dy: -4, blur: 6, color: "#ffffff" }, { dx: 0, dy: 6, blur: 8, color: "#ffffff" }, { dx: 0, dy: -6, blur: 8, color: "#ffffff" }] },
    },
    avatar: { cx: 297, cy: 417, rx: 132, ry: 135 },
    objectives: {
      textRows: [698, 775, 853], barRows: [735, 810, 888],
      leftBar: [112, 478], rightBar: [540, 912], barHeight: 18,
      leftValueRight: 476.5, rightValueRight: 909.5,
      valueStyle: { font: "asap-condensed-700", size: 32.3, color: "#0d0b09", letterSpacing: 0.03 },
      gaugeFill: "#131110e0",
      gaugeRadius: 99,
    },
    table: {
      rows: [1068, 1123, 1178, 1235, 1290, 1346, 1402], x: 567,
      countStyle: { font: "oswald-600", size: 35.9, color: "#0b0907", letterSpacing: 0.06 },
      points: {
        x: 811, dy: -0.5,
        style: { font: "oswald-600", size: 35.9, color: "#0b0806", letterSpacing: 0.06 },
        penaltyColor: "#9a1613",
      },
    },
  },
  {
    id: "theme_3",
    label: "Grimoire",
    background: "/share/themes/theme_3.webp",
    name: {
      x: 517.5, y: 174.5, maxWidth: 390,
      style: { font: "new-rocker-400", size: 90.6, color: "#d5b26f", letterSpacing: 0.04, shadows: [{ dx: 0, dy: 2, blur: 4, color: "rgba(0,0,0,.65)" }] },
    },
    month: {
      x: 720.5, y: 322.5, maxWidth: 310,
      style: { font: "lora-700", size: 26.3, color: "#cfc0a0", letterSpacing: 0.32 },
    },
    score: {
      x: 716, y: 438.5, maxWidth: 335,
      style: { font: "caudex-700", size: 201.8, color: "#cfa54f", letterSpacing: -0.05, shadows: [{ dx: 0, dy: 2, blur: 5, color: "rgba(0,0,0,.6)" }] },
    },
    avatar: { cx: 305, cy: 420, rx: 125, ry: 126 },
    objectives: {
      textRows: [703, 776, 849], barRows: [739, 812, 884],
      leftBar: [128, 470], rightBar: [548, 888], barHeight: 10,
      leftValueRight: 475.5, rightValueRight: 893.5,
      valueStyle: { font: "eb-garamond-500", size: 29.6, color: "#c9a25c", letterSpacing: -0.01 },
      gaugeFill: "#cfa54fd9",
      gaugeRadius: 5,
    },
    table: {
      rows: [1068, 1120, 1171, 1223, 1275, 1326, 1377], x: 575,
      countStyle: { font: "eb-garamond-600", size: 38.4, color: "#d8c9a4", letterSpacing: 0.01 },
      points: {
        x: 808.5, dy: -5.5,
        style: { font: "eb-garamond-600", size: 38.4, color: "#a78552", letterSpacing: 0.01 },
        penaltyColor: "#8f3e30",
      },
    },
  },
  {
    id: "theme_4",
    label: "Carnet maudit",
    background: "/share/themes/theme_4.webp",
    name: {
      x: 524, y: 147.5, maxWidth: 370,
      style: { font: "saira-condensed-800", size: 137.3, color: "#221b10", letterSpacing: -0.05 },
    },
    month: {
      x: 705.5, y: 314.5, maxWidth: 310,
      style: { font: "special-elite", size: 30.7, color: "#3a2f1e", letterSpacing: 0.22 },
    },
    score: {
      x: 696, y: 413.5, maxWidth: 330,
      style: { font: "mona-sans-800", size: 174.4, color: "#332a1c", letterSpacing: -0.03 },
    },
    avatar: { cx: 298, cy: 400, rx: 129, ry: 134 },
    objectives: {
      textRows: [696, 774, 851], barRows: [730, 808, 885],
      leftBar: [115, 470], rightBar: [535, 888], barHeight: 20,
      leftValueRight: 471, rightValueRight: 886,
      valueStyle: { font: "gentium-plus-400", size: 28.4, color: "#453827", letterSpacing: 0.04 },
      gaugeFill: "#3a2d1ad9",
      gaugeRadius: 3,
    },
    table: {
      rows: [1067, 1120, 1173, 1227, 1281, 1335, 1390], x: 560,
      countStyle: { font: "special-elite", size: 36, color: "#362a17", letterSpacing: 0.14 },
      points: {
        x: 786,
        style: { font: "special-elite", size: 36, color: "#261706", letterSpacing: 0.14 },
        penaltyColor: "#4b290e",
      },
    },
  },
  {
    id: "theme_5",
    label: "Film noir",
    background: "/share/themes/theme_5.webp",
    name: {
      x: 514.5, y: 148, maxWidth: 335,
      style: { font: "saira-extra-condensed-800", size: 107, color: "#efe8d8", letterSpacing: 0.11 },
    },
    month: {
      x: 709.5, y: 287, maxWidth: 310,
      style: { font: "special-elite", size: 25.1, color: "#8a8478", letterSpacing: 0.24 },
    },
    score: {
      x: 691.5, y: 407.5, maxWidth: 360,
      style: { font: "sofia-sans-extra-condensed-900-italic", size: 256.6, color: "#b02c22", skewDeg: -5 },
    },
    avatar: { cx: 300, cy: 396, rx: 124 },
    objectives: {
      textRows: [694, 779, 867], barRows: [731, 816, 905],
      leftBar: [120, 485], rightBar: [535, 905], barHeight: 20,
      leftValueRight: 471.5, rightValueRight: 883.5,
      valueStyle: { font: "oswald-500", size: 23.2, color: "#76736c", letterSpacing: 0.11 },
      gaugeFill: "#d8d2c2cc",
      gaugeRadius: 2,
    },
    table: {
      rows: [1084, 1134, 1183, 1232, 1281, 1331, 1380], x: 565,
      countStyle: { font: "roboto-700", size: 30.3, color: "#d6d0c0", letterSpacing: 0.08 },
      points: {
        x: 795.5,
        style: { font: "roboto-700", size: 30.3, color: "#b2aca4", letterSpacing: 0.08 },
        penaltyColor: "#813538",
      },
    },
  },
  {
    id: "theme_6",
    label: "Romance",
    background: "/share/themes/theme_6.webp",
    name: {
      x: 535, y: 144.5, maxWidth: 380,
      style: { font: "abhaya-libre-400", size: 84, color: "#5a2928", letterSpacing: 0.13 },
    },
    month: {
      x: 730, y: 295.5, maxWidth: 310,
      style: { font: "cormorant-700", size: 22.2, color: "#7e746a", letterSpacing: 0.53 },
    },
    score: {
      x: 719.5, y: 407.5, maxWidth: 355,
      style: { font: "libre-caslon-text-400", size: 165, color: "#5c1f1f", letterSpacing: 0.05 },
    },
    avatar: { cx: 308, cy: 411, rx: 123, ry: 128 },
    objectives: {
      textRows: [702, 781, 859], barRows: [737, 817, 895],
      leftBar: [140, 488], rightBar: [558, 905], barHeight: 22,
      leftValueRight: 488.5, rightValueRight: 898.5,
      valueStyle: { font: "eb-garamond-800", size: 25.5, color: "#918a7e", letterSpacing: 0.01 },
      gaugeFill: "#5c1f1fb3",
      gaugeRadius: 99,
    },
    table: {
      rows: [1073, 1127, 1180, 1234, 1288, 1342, 1396], x: 567,
      countStyle: { font: "eb-garamond-600", size: 32.9, color: "#5f4a44", letterSpacing: 0.05 },
      points: {
        x: 800.5, dy: -1.5,
        style: { font: "eb-garamond-600", size: 32.9, color: "#604c44", letterSpacing: 0.05 },
        penaltyColor: "#a07d7c",
      },
    },
  },
  {
    id: "theme_7",
    label: "Sci-fi",
    background: "/share/themes/theme_7.webp",
    name: {
      x: 527.5, y: 145, maxWidth: 325,
      style: { font: "tomorrow-700", size: 67.9, color: "#9fdcff", letterSpacing: 0.02, shadows: [{ dx: 0, dy: 0, blur: 14, color: "rgba(90,200,255,.9)" }, { dx: 0, dy: 0, blur: 30, color: "rgba(60,170,255,.5)" }] },
    },
    month: {
      x: 706, y: 287, maxWidth: 310,
      style: { font: "anybody-600", size: 22.3, color: "#7fc9e8", letterSpacing: 0.5 },
    },
    score: {
      x: 683.5, y: 388.5, maxWidth: 318,
      style: { font: "tomorrow-700-italic", size: 160.5, color: "#eaf7ff", letterSpacing: -0.02, shadows: [{ dx: 0, dy: 0, blur: 10, color: "rgba(140,220,255,1)" }, { dx: 0, dy: 0, blur: 24, color: "rgba(80,190,255,.9)" }, { dx: 0, dy: 0, blur: 48, color: "rgba(50,160,255,.6)" }] },
    },
    avatar: { cx: 311, cy: 393, rx: 128, ry: 131 },
    objectives: {
      textRows: [661, 733, 805], barRows: [691, 763, 835],
      leftBar: [162, 478], rightBar: [545, 855], barHeight: 16,
      leftValueRight: 475, rightValueRight: 857,
      valueStyle: { font: "saira-condensed-700", size: 22.3, color: "#8ecfec", letterSpacing: 0.12 },
      gaugeFill: "#7fd4ff99",
      gaugeRadius: 2,
    },
    table: {
      rows: [995, 1036, 1077, 1118, 1159, 1200, 1241], x: 570,
      countStyle: { font: "rajdhani-700", size: 31.2, color: "#8ecfec", letterSpacing: 0.08 },
      points: {
        x: 780, dy: 3,
        style: { font: "rajdhani-700", size: 31.2, color: "#86d1ef", letterSpacing: 0.08 },
        penaltyColor: "#c06364",
      },
    },
  },
  {
    id: "theme_8",
    label: "Comics pop",
    background: "/share/themes/theme_8.webp",
    name: {
      x: 518, y: 174, maxWidth: 520,
      style: { font: "finlandica-headline-900-italic", size: 132.4, color: "#f2e5c8", letterSpacing: -0.01, skewDeg: -5, stroke: { width: 3.6, color: "#15100c" }, shadows: [{ dx: 5.2, dy: 5.2, blur: 0, color: "#c62a1e" }, { dx: 8.3, dy: 8.3, blur: 0, color: "#15100c" }] },
    },
    month: {
      x: 740.5, y: 325, maxWidth: 310,
      style: { font: "roboto-condensed-900", size: 39.5, color: "#191512", letterSpacing: 0.25 },
    },
    score: {
      x: 716.5, y: 432.5, maxWidth: 375,
      style: { font: "amaranth-700-italic", size: 242.2, color: "#d0281c", letterSpacing: -0.04, skewDeg: -5, stroke: { width: 5.1, color: "#15100c" }, shadows: [{ dx: 8.5, dy: 8.5, blur: 0, color: "#15100c" }, { dx: 17, dy: 13.6, blur: 0, color: "#58c33a" }] },
    },
    avatar: { cx: 288, cy: 436, rx: 130 },
    objectives: {
      textRows: [698.5, 772.5, 850.5], barRows: [733, 806, 885],
      leftBar: [105, 478], rightBar: [540, 918], barHeight: 20,
      leftValueRight: 469, rightValueRight: 919,
      valueStyle: { font: "barlow-800-italic", size: 33, color: "#16120e" },
      gaugeFill: "#d0281ccc",
      gaugeRadius: 3,
    },
    table: {
      rows: [1043, 1096, 1149, 1201, 1254, 1306, 1360], x: 572,
      countStyle: { font: "noto-sans-800-italic", size: 42.4, color: "#16120e", letterSpacing: 0.09 },
      points: {
        x: 810, dy: -5.5,
        style: { font: "noto-sans-800-italic", size: 42.4, color: "#1f4a8f", letterSpacing: 0.09, skewDeg: -1, stroke: { width: 7, color: "#15100c" } },
        penaltyColor: "#c42e25", zeroColor: "#f2e5c8",
      },
    },
  },
  {
    id: "theme_9",
    label: "Western",
    background: "/share/themes/theme_9.webp",
    name: {
      x: 525.5, y: 191, maxWidth: 580,
      style: { font: "alfa-slab-one", size: 124.2, color: "#3a2812" },
    },
    month: {
      x: 711, y: 337.5, maxWidth: 310,
      style: { font: "barlow-condensed-800", size: 38, color: "#46301a", letterSpacing: 0.25 },
    },
    score: {
      x: 705.5, y: 430, maxWidth: 342,
      style: { font: "barlow-condensed-900-italic", size: 227.6, color: "#7a3a10", letterSpacing: 0.01 },
    },
    avatar: { cx: 323, cy: 437, rx: 128, ry: 132 },
    objectives: {
      textRows: [730, 804, 882], barRows: [762, 836, 913],
      leftBar: [145, 482], rightBar: [525, 890], barHeight: 22,
      leftValueRight: 478, rightValueRight: 888,
      valueStyle: { font: "saira-condensed-800", size: 31.2, color: "#46301a", letterSpacing: 0.01 },
      gaugeFill: "#5c422acc",
      gaugeRadius: 3,
    },
    table: {
      rows: [1075, 1123, 1170, 1219, 1267, 1315, 1364], x: 590,
      countStyle: { font: "aleo-900", size: 35.7, color: "#46301a", letterSpacing: 0.02 },
      points: {
        x: 790, dy: 4.5,
        style: { font: "aleo-900", size: 35.7, color: "#4b2f0d", letterSpacing: 0.02 },
        penaltyColor: "#783210",
      },
    },
  },
  {
    // Calé par superposition sur le modèle rempli (theme_10.jpeg) : polices
    // criblées sur le catalogue Google, départagées au calque rouge/cyan —
    // Alegreya 900 (pseudo, en arc sur la bannière, R ≈ 2 000 px), Literata 800
    // (score, étiré à la hauteur du modèle : boîte 609→818 × 389→500 au pixel),
    // Literata 700 (tout le reste). Géométrie (jauges, lignes du tableau, cercle)
    // mesurée au pixel sur le fond.
    id: "theme_10",
    label: "Carte au trésor",
    background: "/share/themes/theme_10.webp",
    name: {
      x: 520, y: 121, maxWidth: 470,
      style: {
        font: "alegreya-900", size: 110, color: "#eecd9c", letterSpacing: 0.02, arcRadius: 2000,
        // L'embossage du modèle : la lettre crème posée sur la bannière.
        shadows: [{ dx: 1, dy: 3, blur: 2, color: "rgba(10,24,26,.75)" }],
      },
    },
    month: {
      x: 716, y: 316, maxWidth: 300,
      style: { font: "literata-700", size: 31, color: "#1c342b", letterSpacing: 0.24 },
    },
    score: {
      x: 709, y: 438, maxWidth: 300,
      style: { font: "literata-800", size: 144, color: "#18383c", scaleY: 1.087 },
    },
    avatar: { cx: 315, cy: 405, rx: 134 },
    objectives: {
      textRows: [747, 838, 929], barRows: [785, 876, 967],
      leftBar: [154, 467], rightBar: [557, 870], barHeight: 21,
      leftValueRight: 465, rightValueRight: 869,
      valueStyle: { font: "literata-700", size: 22, color: "#223228", letterSpacing: 0.07 },
      gaugeFill: "#1f4b4fd9",
      gaugeRadius: 99,
    },
    table: {
      rows: [1172, 1217, 1262, 1308, 1353, 1399, 1448], x: 575,
      countStyle: { font: "literata-700", size: 30, color: "#192d24" },
      points: {
        x: 809,
        style: { font: "literata-700", size: 30, color: "#203428" },
        penaltyColor: "#841506",
      },
    },
  },
];
