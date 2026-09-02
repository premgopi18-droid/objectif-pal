/**
 * Les thèmes de la carte de partage (specs §4.15, issue #263) — LE fichier de
 * coordonnées : chaque zone de chaque thème, MESURÉE au pixel sur les fonds
 * vierges dans le labo de calage `docs/protos/proto-share-cards.html`
 * (superpositions, mode ?iso=1, planches-spécimens pour les polices).
 *
 * Tout nouveau thème se calibre D'ABORD dans le proto, puis se porte ici.
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

/** Les polices auto-hébergées (woff2 latin, public/share/fonts/ — RGPD : jamais de hotlink Google). */
export const SHARE_FONTS = {
  "alfa-slab-one": { family: "Alfa Slab One", weight: 400, italic: false, file: "alfa-slab-one-400.woff2" },
  anton: { family: "Anton", weight: 400, italic: false, file: "anton-400.woff2" },
  "archivo-black": { family: "Archivo Black", weight: 400, italic: false, file: "archivo-black-400.woff2" },
  bangers: { family: "Bangers", weight: 400, italic: false, file: "bangers-400.woff2" },
  cinzel: { family: "Cinzel", weight: 400, italic: false, file: "cinzel-400.woff2" },
  "cormorant-500": { family: "Cormorant Garamond", weight: 500, italic: false, file: "cormorant-garamond-500.woff2" },
  "cormorant-700": { family: "Cormorant Garamond", weight: 700, italic: false, file: "cormorant-garamond-700.woff2" },
  "eb-garamond-500": { family: "EB Garamond", weight: 500, italic: false, file: "eb-garamond-500.woff2" },
  "eb-garamond-600": { family: "EB Garamond", weight: 600, italic: false, file: "eb-garamond-600.woff2" },
  "exo-2-600": { family: "Exo 2", weight: 600, italic: false, file: "exo-2-600.woff2" },
  "exo-2-800-italic": { family: "Exo 2", weight: 800, italic: true, file: "exo-2-800-italic.woff2" },
  graduate: { family: "Graduate", weight: 400, italic: false, file: "graduate-400.woff2" },
  "grenze-gotisch-700": { family: "Grenze Gotisch", weight: 700, italic: false, file: "grenze-gotisch-700.woff2" },
  knewave: { family: "Knewave", weight: 400, italic: false, file: "knewave-400.woff2" },
  "orbitron-800": { family: "Orbitron", weight: 800, italic: false, file: "orbitron-800.woff2" },
  "oswald-500": { family: "Oswald", weight: 500, italic: false, file: "oswald-500.woff2" },
  "oswald-600": { family: "Oswald", weight: 600, italic: false, file: "oswald-600.woff2" },
  "playfair-600": { family: "Playfair Display", weight: 600, italic: false, file: "playfair-display-600.woff2" },
  "playfair-700": { family: "Playfair Display", weight: 700, italic: false, file: "playfair-display-700.woff2" },
  "rajdhani-600": { family: "Rajdhani", weight: 600, italic: false, file: "rajdhani-600.woff2" },
  "rajdhani-700": { family: "Rajdhani", weight: 700, italic: false, file: "rajdhani-700.woff2" },
  rye: { family: "Rye", weight: 400, italic: false, file: "rye-400.woff2" },
  "special-elite": { family: "Special Elite", weight: 400, italic: false, file: "special-elite-400.woff2" },
  "stardos-stencil-700": { family: "Stardos Stencil", weight: 700, italic: false, file: "stardos-stencil-700.woff2" },
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
  };
};

export const SHARE_THEMES: readonly ShareTheme[] = [
  {
    id: "theme_0",
    label: "Néon",
    background: "/share/themes/theme_0.webp",
    name: {
      x: 525, y: 140, maxWidth: 340,
      style: { font: "exo-2-800-italic", size: 81, color: "#ffffff", letterSpacing: 0.04 },
    },
    month: {
      x: 700, y: 308, maxWidth: 310,
      style: { font: "exo-2-600", size: 33, color: "#a99cf0", letterSpacing: 0.42 },
    },
    score: {
      x: 700, y: 414, maxWidth: 370,
      style: {
        font: "exo-2-800-italic", size: 160,
        gradient: { angleDeg: 105, stops: [{ at: 0.05, color: "#ff45c8" }, { at: 0.45, color: "#7a58f2" }, { at: 0.9, color: "#2bd8d8" }] },
      },
    },
    avatar: { cx: 272, cy: 400, rx: 120 },
    objectives: {
      textRows: [667, 744, 821], barRows: [702, 776, 853],
      leftBar: [112, 476], rightBar: [545, 915], barHeight: 16,
      leftValueRight: 477, rightValueRight: 913,
      valueStyle: { font: "exo-2-600", size: 31, color: "#a99cf0" },
      gaugeFill: { angleDeg: 90, stops: [{ at: 0, color: "#ff4fa8" }, { at: 1, color: "#2ee6a8" }] },
      gaugeRadius: 99,
    },
    table: {
      rows: [1043, 1103, 1163, 1223, 1283, 1341, 1401], x: 565,
      countStyle: { font: "exo-2-600", size: 34, color: "#eae6f8" },
    },
  },
  {
    id: "theme_1",
    label: "Dossier confidentiel",
    background: "/share/themes/theme_1.webp",
    name: {
      x: 527, y: 205, maxWidth: 475,
      style: { font: "stardos-stencil-700", size: 119, color: "#4a4124", letterSpacing: 0.08 },
    },
    month: {
      x: 735, y: 335, maxWidth: 310,
      style: { font: "special-elite", size: 43, color: "#4d412d", letterSpacing: 0.3 },
    },
    score: {
      x: 730, y: 460, maxWidth: 350,
      style: { font: "alfa-slab-one", size: 195, color: "#2a2419" },
    },
    avatar: { cx: 306, cy: 452, rx: 154 },
    objectives: {
      textRows: [760, 845, 928], barRows: [800, 884, 966],
      leftBar: [162, 484], rightBar: [556, 893], barHeight: 26,
      leftValueRight: 480, rightValueRight: 890,
      valueStyle: { font: "special-elite", size: 35, color: "#4a4236" },
      gaugeFill: "#3f3524d9",
      gaugeRadius: 3,
    },
    table: {
      rows: [1130, 1178, 1222, 1268, 1312, 1358, 1404], x: 595,
      countStyle: { font: "special-elite", size: 38, color: "#3a332a" },
    },
  },
  {
    id: "theme_2",
    label: "Manga",
    background: "/share/themes/theme_2.webp",
    name: {
      x: 525, y: 145, maxWidth: 510,
      style: { font: "knewave", size: 113, color: "#131110", letterSpacing: 0.02, skewDeg: -6 },
    },
    month: {
      x: 715, y: 295, maxWidth: 310,
      style: { font: "oswald-600", size: 38, color: "#0e0c0a", letterSpacing: 0.4 },
    },
    score: {
      x: 720, y: 422, maxWidth: 390,
      style: {
        font: "archivo-black", size: 210, color: "#131110", skewDeg: -8,
        shadows: [
          { dx: 0, dy: 0, blur: 4, color: "#ffffff" }, { dx: 0, dy: 0, blur: 8, color: "#ffffff" },
          { dx: 0, dy: 0, blur: 14, color: "#ffffff" }, { dx: 4, dy: 4, blur: 6, color: "#ffffff" },
          { dx: -4, dy: 4, blur: 6, color: "#ffffff" }, { dx: 4, dy: -4, blur: 6, color: "#ffffff" },
          { dx: -4, dy: -4, blur: 6, color: "#ffffff" }, { dx: 0, dy: 6, blur: 8, color: "#ffffff" },
          { dx: 0, dy: -6, blur: 8, color: "#ffffff" },
        ],
      },
    },
    avatar: { cx: 301, cy: 430, rx: 129, ry: 128 },
    objectives: {
      textRows: [700, 777, 855], barRows: [735, 810, 888],
      leftBar: [112, 478], rightBar: [540, 912], barHeight: 18,
      leftValueRight: 477, rightValueRight: 910,
      valueStyle: { font: "oswald-600", size: 33, color: "#0d0b09" },
      gaugeFill: "#131110e0",
      gaugeRadius: 99,
    },
    table: {
      rows: [1068, 1123, 1178, 1235, 1290, 1346, 1402], x: 567,
      countStyle: { font: "oswald-600", size: 36, color: "#0b0907" },
    },
  },
  {
    id: "theme_3",
    label: "Grimoire",
    background: "/share/themes/theme_3.webp",
    name: {
      x: 510, y: 170, maxWidth: 390,
      style: {
        font: "grenze-gotisch-700", size: 106, color: "#d5b26f", letterSpacing: 0.12,
        shadows: [{ dx: 0, dy: 2, blur: 4, color: "rgba(0,0,0,.65)" }],
      },
    },
    month: {
      x: 720, y: 320, maxWidth: 310,
      style: { font: "cinzel", size: 37, color: "#cfc0a0", letterSpacing: 0.42 },
    },
    score: {
      x: 720, y: 432, maxWidth: 355,
      style: {
        font: "cormorant-700", size: 213, color: "#cfa54f",
        shadows: [{ dx: 0, dy: 2, blur: 5, color: "rgba(0,0,0,.6)" }],
      },
    },
    avatar: { cx: 300, cy: 426, rx: 111 },
    objectives: {
      textRows: [706, 779, 852], barRows: [739, 812, 884],
      leftBar: [128, 470], rightBar: [548, 888], barHeight: 10,
      leftValueRight: 472, rightValueRight: 890,
      valueStyle: { font: "eb-garamond-600", size: 36, color: "#c9a25c" },
      gaugeFill: "#cfa54fd9",
      gaugeRadius: 5,
    },
    table: {
      rows: [1068, 1120, 1171, 1223, 1275, 1326, 1377], x: 575,
      countStyle: { font: "eb-garamond-600", size: 37, color: "#d8c9a4" },
    },
  },
  {
    id: "theme_4",
    label: "Carnet maudit",
    background: "/share/themes/theme_4.webp",
    name: {
      x: 520, y: 145, maxWidth: 370,
      style: { font: "anton", size: 102, color: "#221b10", letterSpacing: 0.1 },
    },
    month: {
      x: 711, y: 310, maxWidth: 310,
      style: { font: "special-elite", size: 40, color: "#3a2f1e", letterSpacing: 0.3 },
    },
    score: {
      x: 705, y: 415, maxWidth: 365,
      style: { font: "anton", size: 203, color: "#332a1c" },
    },
    avatar: { cx: 299, cy: 405, rx: 126 },
    objectives: {
      textRows: [696, 774, 851], barRows: [730, 808, 885],
      leftBar: [115, 470], rightBar: [535, 888], barHeight: 20,
      leftValueRight: 470, rightValueRight: 885,
      valueStyle: { font: "special-elite", size: 33, color: "#453827" },
      gaugeFill: "#3a2d1ad9",
      gaugeRadius: 3,
    },
    table: {
      rows: [1067, 1120, 1173, 1227, 1281, 1335, 1390], x: 560,
      countStyle: { font: "special-elite", size: 38, color: "#362a17" },
    },
  },
  {
    id: "theme_5",
    label: "Film noir",
    background: "/share/themes/theme_5.webp",
    name: {
      x: 515, y: 142, maxWidth: 335,
      style: { font: "oswald-600", size: 95, color: "#efe8d8", letterSpacing: 0.16 },
    },
    month: {
      x: 711, y: 290, maxWidth: 310,
      style: { font: "special-elite", size: 37, color: "#8a8478", letterSpacing: 0.32 },
    },
    score: {
      x: 708, y: 400, maxWidth: 400,
      style: { font: "anton", size: 200, color: "#b02c22", skewDeg: -10 },
    },
    avatar: { cx: 300, cy: 396, rx: 124 },
    objectives: {
      textRows: [694, 779, 867], barRows: [731, 816, 905],
      leftBar: [120, 485], rightBar: [535, 905], barHeight: 20,
      leftValueRight: 476, rightValueRight: 888,
      valueStyle: { font: "oswald-500", size: 34, color: "#d6d0c0" },
      gaugeFill: "#d8d2c2cc",
      gaugeRadius: 2,
    },
    table: {
      rows: [1084, 1134, 1183, 1232, 1281, 1331, 1380], x: 565,
      countStyle: { font: "oswald-500", size: 35, color: "#d6d0c0" },
    },
  },
  {
    id: "theme_6",
    label: "Romance",
    background: "/share/themes/theme_6.webp",
    name: {
      x: 535, y: 142, maxWidth: 380,
      style: { font: "playfair-600", size: 82, color: "#5a2928", letterSpacing: 0.2 },
    },
    month: {
      x: 727, y: 293, maxWidth: 310,
      style: { font: "cormorant-500", size: 37, color: "#9a9288", letterSpacing: 0.4 },
    },
    score: {
      // Posé sur la fioriture (ancrage revu au calage : la virgule effleure
      // l'ornement sans le couvrir — centre recalculé en conséquence).
      x: 727, y: 401, maxWidth: 375,
      style: { font: "playfair-700", size: 174, color: "#5c1f1f" },
    },
    avatar: { cx: 307, cy: 421, rx: 121, ry: 131 },
    objectives: {
      textRows: [703, 782, 860], barRows: [737, 817, 895],
      leftBar: [140, 488], rightBar: [558, 905], barHeight: 22,
      leftValueRight: 490, rightValueRight: 900,
      valueStyle: { font: "eb-garamond-500", size: 37, color: "#918a7e" },
      gaugeFill: "#5c1f1fb3",
      gaugeRadius: 99,
    },
    table: {
      rows: [1073, 1127, 1180, 1234, 1288, 1342, 1396], x: 567,
      countStyle: { font: "eb-garamond-500", size: 37, color: "#5f4a44" },
    },
  },
  {
    id: "theme_7",
    label: "Sci-fi",
    background: "/share/themes/theme_7.webp",
    name: {
      x: 525, y: 150, maxWidth: 325,
      style: {
        font: "orbitron-800", size: 75, color: "#9fdcff", letterSpacing: 0.1,
        shadows: [
          { dx: 0, dy: 0, blur: 14, color: "rgba(90,200,255,.9)" },
          { dx: 0, dy: 0, blur: 30, color: "rgba(60,170,255,.5)" },
        ],
      },
    },
    month: {
      x: 700, y: 285, maxWidth: 310,
      style: { font: "rajdhani-600", size: 34, color: "#7fc9e8", letterSpacing: 0.44 },
    },
    score: {
      x: 690, y: 390, maxWidth: 335,
      style: {
        font: "exo-2-800-italic", size: 150, color: "#eaf7ff",
        shadows: [
          { dx: 0, dy: 0, blur: 10, color: "rgba(140,220,255,1)" },
          { dx: 0, dy: 0, blur: 24, color: "rgba(80,190,255,.9)" },
          { dx: 0, dy: 0, blur: 48, color: "rgba(50,160,255,.6)" },
        ],
      },
    },
    avatar: { cx: 311, cy: 393, rx: 128, ry: 131 },
    objectives: {
      textRows: [660, 732, 804], barRows: [691, 763, 835],
      leftBar: [162, 478], rightBar: [545, 855], barHeight: 16,
      leftValueRight: 476, rightValueRight: 858,
      valueStyle: { font: "rajdhani-700", size: 33, color: "#8ecfec" },
      gaugeFill: "#7fd4ff99",
      gaugeRadius: 2,
    },
    table: {
      rows: [995, 1036, 1077, 1118, 1159, 1200, 1241], x: 570,
      countStyle: { font: "rajdhani-700", size: 34, color: "#8ecfec" },
    },
  },
  {
    id: "theme_8",
    label: "Comics pop",
    background: "/share/themes/theme_8.webp",
    name: {
      // Ombres en px, calées sur le corps mesuré (le proto parlait en em).
      x: 520, y: 178, maxWidth: 520,
      style: {
        font: "bangers", size: 104, color: "#f2e5c8", letterSpacing: 0.05,
        stroke: { width: 3.6, color: "#15100c" },
        shadows: [
          { dx: 5.2, dy: 5.2, blur: 0, color: "#c62a1e" },
          { dx: 8.3, dy: 8.3, blur: 0, color: "#15100c" },
        ],
      },
    },
    month: {
      x: 756, y: 320, maxWidth: 310,
      style: { font: "archivo-black", size: 43, color: "#191512", letterSpacing: 0.3 },
    },
    score: {
      x: 735, y: 455, maxWidth: 395,
      style: {
        font: "bangers", size: 170, color: "#d0281c",
        stroke: { width: 5.1, color: "#15100c" },
        shadows: [
          { dx: 8.5, dy: 8.5, blur: 0, color: "#15100c" },
          { dx: 17, dy: 13.6, blur: 0, color: "#58c33a" },
        ],
      },
    },
    avatar: { cx: 288, cy: 436, rx: 130 },
    objectives: {
      textRows: [700, 774, 852], barRows: [733, 806, 885],
      leftBar: [105, 478], rightBar: [540, 918], barHeight: 20,
      leftValueRight: 465, rightValueRight: 915,
      valueStyle: { font: "archivo-black", size: 33, color: "#16120e" },
      gaugeFill: "#d0281ccc",
      gaugeRadius: 3,
    },
    table: {
      rows: [1043, 1096, 1149, 1201, 1254, 1306, 1360], x: 572,
      countStyle: { font: "archivo-black", size: 34, color: "#16120e" },
    },
  },
  {
    id: "theme_9",
    label: "Western",
    background: "/share/themes/theme_9.webp",
    name: {
      x: 520, y: 180, maxWidth: 580,
      style: { font: "alfa-slab-one", size: 133, color: "#3a2812", letterSpacing: 0.06 },
    },
    month: {
      x: 709, y: 338, maxWidth: 310,
      style: { font: "graduate", size: 45, color: "#46301a", letterSpacing: 0.3 },
    },
    score: {
      x: 712, y: 452, maxWidth: 360,
      style: { font: "rye", size: 215, color: "#7a3a10" },
    },
    avatar: { cx: 324, cy: 447, rx: 124 },
    objectives: {
      textRows: [728, 802, 880], barRows: [762, 836, 913],
      leftBar: [145, 482], rightBar: [525, 890], barHeight: 22,
      leftValueRight: 490, rightValueRight: 900,
      valueStyle: { font: "graduate", size: 33, color: "#46301a" },
      gaugeFill: "#5c422acc",
      gaugeRadius: 3,
    },
    table: {
      rows: [1075, 1123, 1170, 1219, 1267, 1315, 1364], x: 590,
      countStyle: { font: "graduate", size: 38, color: "#46301a" },
    },
  },
];
