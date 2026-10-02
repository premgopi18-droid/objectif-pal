import { formatPoints } from "@/lib/scoring/report-text";
import { arcGlyphPlacements, splitGraphemes } from "@/lib/share/arc-layout";
import { formatObjectiveCell, type ShareCardData } from "@/lib/share/card-data";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SHARE_FONTS,
  type ShareFontKey,
  type ShareGradient,
  type ShareTextStyle,
  type ShareTheme,
  versionedBackgroundUrl,
} from "@/lib/share/themes";

/**
 * Le moteur de rendu de la carte (§4.15, issue #263) — canvas, côté client
 * uniquement : tout se dessine sur l'appareil au moment du tap, rien ne part
 * sur un serveur. Le rendu reproduit le labo de calage
 * (`docs/protos/proto-share-cards.html`) : mêmes coordonnées, mêmes règles.
 *
 * Parité CSS assumée explicitement :
 * - centrage vertical par la boîte de ligne (`line-height: 1`) : la ligne de
 *   base tombe à y + (ascender − descender) / 2 — métriques de police, pas
 *   boîte des glyphes, sinon « 0 » et « +48,5 » ne se centreraient pas pareil ;
 * - l'interlettrage traîne après le dernier glyphe : la largeur utile le
 *   retranche (le proto compensait par margin-right négatif) ;
 * - les ombres CSS se peignent premier-listé AU-DESSUS : le canvas les dessine
 *   en ordre inverse, puis contour, puis remplissage ;
 * - rétrécissement automatique réservé aux zones à `maxWidth` (pseudo, date,
 *   score) — les valeurs répétées gardent leur corps fixe.
 */

const FONT_BASE_PATH = "/share/fonts/";

/** Le dégradé signature de l'app — le repli avatar (initiale) le porte. */
const FALLBACK_AVATAR_GRADIENT: [string, string] = ["#e33d8f", "#38d1c1"];

// --- Chargement (poli, mutualisé) ------------------------------------------

const loadedFontKeys = new Set<ShareFontKey>();

function themeFontKeys(theme: ShareTheme): ShareFontKey[] {
  return [
    ...new Set([
      theme.name.style.font,
      theme.month.style.font,
      theme.score.style.font,
      theme.objectives.valueStyle.font,
      theme.table.countStyle.font,
      theme.table.points.style.font,
    ]),
  ];
}

/** Charge les polices du thème (woff2 auto-hébergés) — une seule fois chacune. */
export async function loadThemeFonts(theme: ShareTheme): Promise<void> {
  await Promise.all(
    themeFontKeys(theme).map(async (key) => {
      if (loadedFontKeys.has(key)) return;
      const font = SHARE_FONTS[key];
      const face = new FontFace(font.family, `url(${FONT_BASE_PATH}${font.file})`, {
        weight: String(font.weight),
        style: font.italic ? "italic" : "normal",
      });
      await face.load();
      document.fonts.add(face);
      loadedFontKeys.add(key);
    }),
  );
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();

/**
 * Charge une image dessinable au canvas. `crossOrigin` : l'avatar vient du
 * Storage Supabase — sans lui, le canvas serait « tainted » et `toBlob`
 * refuserait d'exporter.
 *
 * Les `blob:` (photos d'invités, uniques par choix puis révoquées) ne sont
 * JAMAIS mises en cache : le Map module-level ne se vide pas, et retenir
 * chaque photo décodée ferait gonfler la mémoire à chaque invité du live
 * (review #267). Les URLs stables (fonds, avatar) restent cachées.
 */
export function loadCardImage(src: string): Promise<HTMLImageElement> {
  const cached = imageCache.get(src);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(src);
      reject(new Error(`image introuvable : ${src}`));
    };
    image.src = src;
  });
  if (!src.startsWith("blob:")) imageCache.set(src, promise);
  return promise;
}

// --- Texte ------------------------------------------------------------------

function cssFont(style: ShareTextStyle): string {
  const font = SHARE_FONTS[style.font];
  return `${font.italic ? "italic " : ""}${font.weight} ${style.size}px "${font.family}"`;
}

type Ctx = CanvasRenderingContext2D;

/** La ligne de base d'un texte centré dans sa boîte de ligne (`line-height: 1`). */
function lineBoxBaseline(ctx: Ctx, y: number): number {
  const metrics = ctx.measureText("Hg");
  return y + (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
}

/**
 * Firefox n'implémente pas `letterSpacing` sur le canvas : l'affectation y est
 * inerte et le texte se dessine resserré — dégradation ASSUMÉE (mesure et
 * rendu partagent le même état, tout reste centré). Le prototype fait foi :
 * une affectation ratée laisserait une propriété propre trompeuse (review #264).
 */
const letterSpacingSupported = (): boolean =>
  typeof CanvasRenderingContext2D !== "undefined" && "letterSpacing" in CanvasRenderingContext2D.prototype;

/**
 * Largeur utile du texte : l'interlettrage traînant du dernier glyphe est
 * retranché — seulement s'il s'applique réellement (sinon le centre glisserait
 * de ls/2 sur les navigateurs sans letterSpacing).
 */
function usefulWidth(ctx: Ctx, text: string, style: ShareTextStyle): number {
  const trailing = letterSpacingSupported() ? (style.letterSpacing ?? 0) * style.size : 0;
  return Math.max(1, ctx.measureText(text).width - trailing);
}

function applyLetterSpacing(ctx: Ctx, style: ShareTextStyle): void {
  if (!letterSpacingSupported()) return;
  ctx.letterSpacing = `${(style.letterSpacing ?? 0) * style.size}px`;
}

function textPaint(ctx: Ctx, style: ShareTextStyle, x: number, width: number, baseline: number): string | CanvasGradient {
  if (style.gradient === undefined) return style.color ?? "#000000";
  return cssGradient(ctx, style.gradient, x - width / 2, baseline - style.size * 0.72, width, style.size);
}

/** Un dégradé à l'angle CSS (0° = vers le haut, 90° = vers la droite) sur une boîte. */
function cssGradient(ctx: Ctx, gradient: ShareGradient, x: number, y: number, width: number, height: number): CanvasGradient {
  const angle = (gradient.angleDeg * Math.PI) / 180;
  const dirX = Math.sin(angle);
  const dirY = -Math.cos(angle);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  // La longueur de la ligne de dégradé, comme en CSS.
  const length = Math.abs(width * dirX) + Math.abs(height * dirY);
  const paint = ctx.createLinearGradient(
    centerX - (dirX * length) / 2,
    centerY - (dirY * length) / 2,
    centerX + (dirX * length) / 2,
    centerY + (dirY * length) / 2,
  );
  for (const stop of gradient.stops) paint.addColorStop(stop.at, stop.color);
  return paint;
}

type Align = "center" | "right";

/**
 * Dessine un texte : ombres (ordre CSS), contour, remplissage — avec
 * rétrécissement automatique si `maxWidth` est fourni (instances uniques).
 */
function drawText(
  ctx: Ctx,
  text: string,
  x: number,
  y: number,
  style: ShareTextStyle,
  options: { maxWidth?: number; align?: Align } = {},
): void {
  ctx.save();
  ctx.font = cssFont(style);
  applyLetterSpacing(ctx, style);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  const width = usefulWidth(ctx, text, style);
  const scale = options.maxWidth !== undefined ? Math.min(1, options.maxWidth / width) : 1;
  const baseline = lineBoxBaseline(ctx, y);
  const anchorX = options.align === "right" ? x - width * scale : x - (width * scale) / 2;

  // Échelle et penché autour du point d'ancrage — comme le span du proto.
  ctx.translate(anchorX, baseline);
  if (scale !== 1) ctx.scale(scale, scale);
  // Étirement vertical autour de la ligne de base : le pied des glyphes reste en place.
  if (style.scaleY !== undefined) ctx.scale(1, style.scaleY);
  const applySkew = () => {
    if (style.skewDeg) ctx.transform(1, 0, Math.tan((style.skewDeg * Math.PI) / 180), 1, 0, 0);
  };

  const paint = textPaint(ctx, style, width / 2, width, 0);

  // Les trois couches d'un texte, à l'origine courante.
  const paintRun = (run: string, left: number) => {
    // CSS peint la première ombre AU-DESSUS des suivantes → ordre inverse ici.
    for (const shadow of [...(style.shadows ?? [])].reverse()) {
      ctx.save();
      ctx.shadowColor = shadow.color;
      ctx.shadowOffsetX = shadow.dx;
      ctx.shadowOffsetY = shadow.dy;
      ctx.shadowBlur = shadow.blur;
      ctx.fillStyle = paint;
      ctx.fillText(run, left, 0);
      ctx.restore();
    }
    if (style.stroke) {
      ctx.lineWidth = style.stroke.width;
      ctx.lineJoin = "round";
      ctx.strokeStyle = style.stroke.color;
      ctx.strokeText(run, left, 0);
    }
    ctx.fillStyle = paint;
    ctx.fillText(run, left, 0);
  };

  if (style.arcRadius === undefined) {
    applySkew();
    paintRun(text, 0);
  } else {
    // Texte cintré : chaque glyphe sur l'arc, incliné sur sa tangente, autour du
    // centre du mot. Le rayon est en px de la carte : un pseudo rétréci garde la
    // courbure de son cartouche. Les ombres restent verticales (le canvas les
    // décale dans l'espace de l'écran, pas dans celui du glyphe).
    const characters = splitGraphemes(text);
    const prefixWidths = characters.map((_, index) => ctx.measureText(characters.slice(0, index).join("")).width);
    prefixWidths.push(ctx.measureText(text).width);
    const spacing = letterSpacingSupported() ? (style.letterSpacing ?? 0) * style.size : 0;
    arcGlyphPlacements(prefixWidths, spacing, style.arcRadius / scale).forEach((glyph, index) => {
      ctx.save();
      ctx.translate(width / 2 + glyph.x, glyph.y);
      ctx.rotate(glyph.angle);
      applySkew();
      paintRun(characters[index], -glyph.width / 2);
      ctx.restore();
    });
  }
  ctx.restore();
}

// --- Les blocs de la carte ---------------------------------------------------

function drawAvatar(ctx: Ctx, theme: ShareTheme, avatar: HTMLImageElement | null, initial: string): void {
  const { cx, cy, rx } = theme.avatar;
  const ry = theme.avatar.ry ?? rx;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  if (avatar !== null) {
    // Cover : le masque est TOUJOURS rempli, jamais déformé, jamais dépassé.
    const scale = Math.max((rx * 2) / avatar.naturalWidth, (ry * 2) / avatar.naturalHeight);
    const drawWidth = avatar.naturalWidth * scale;
    const drawHeight = avatar.naturalHeight * scale;
    ctx.drawImage(avatar, cx - drawWidth / 2, cy - drawHeight / 2, drawWidth, drawHeight);
  } else {
    // Repli sans photo : l'initiale sur le dégradé signature, comme dans l'app.
    const paint = ctx.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
    paint.addColorStop(0, FALLBACK_AVATAR_GRADIENT[0]);
    paint.addColorStop(1, FALLBACK_AVATAR_GRADIENT[1]);
    ctx.fillStyle = paint;
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);
    ctx.font = `900 ${Math.round(ry)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#14121a";
    ctx.fillText(initial, cx, cy + ry * 0.04);
  }
  ctx.restore();
}

function drawObjectives(ctx: Ctx, theme: ShareTheme, data: ShareCardData): void {
  const spec = theme.objectives;
  data.objectives.forEach((cell, index) => {
    const row = index % 3;
    const valueRight = index < 3 ? spec.leftValueRight : spec.rightValueRight;
    drawText(ctx, formatObjectiveCell(cell), valueRight, spec.textRows[row], spec.valueStyle, { align: "right" });

    if (cell === null || cell.ratio <= 0) return;
    const [barStart, barEnd] = index < 3 ? spec.leftBar : spec.rightBar;
    const inset = 6;
    const width = (barEnd - barStart - inset * 2) * cell.ratio;
    const height = Math.max(6, spec.barHeight - 6);
    const top = spec.barRows[row] - height / 2;
    ctx.save();
    ctx.fillStyle =
      typeof spec.gaugeFill === "string"
        ? spec.gaugeFill
        : cssGradient(ctx, spec.gaugeFill, barStart + inset, top, width, height);
    ctx.beginPath();
    ctx.roundRect(barStart + inset, top, width, height, Math.min(spec.gaugeRadius, height / 2));
    ctx.fill();
    ctx.restore();
  });
}

function drawCounts(ctx: Ctx, theme: ShareTheme, data: ShareCardData): void {
  data.counts.forEach((count, index) => {
    drawText(ctx, String(count), theme.table.x, theme.table.rows[index], theme.table.countStyle);
  });
}

/**
 * La colonne PTS : ce que chaque ligne rapporte, à l'encre du signe — gain,
 * malus, ou l'encre neutre du zéro (§4.15).
 */
function drawPoints(ctx: Ctx, theme: ShareTheme, data: ShareCardData): void {
  const { x, style, penaltyColor, zeroColor = theme.table.countStyle.color } = theme.table.points;
  data.points.forEach((points, index) => {
    const color = points > 0 ? style.color : points < 0 ? penaltyColor : zeroColor;
    drawText(ctx, formatPoints(points), x, theme.table.rows[index], { ...style, color });
  });
}

// --- L'entrée du moteur ------------------------------------------------------

/**
 * Rend la carte complète sur un canvas (1024×1536). Charge polices et images
 * si nécessaire ; l'avatar manquant (ou en échec) devient l'initiale sur le
 * dégradé — la carte reste toujours présentable.
 */
export async function renderShareCard(
  canvas: HTMLCanvasElement,
  theme: ShareTheme,
  data: ShareCardData,
  avatarUrl: string | null,
): Promise<void> {
  const [background, avatar] = await Promise.all([
    loadCardImage(versionedBackgroundUrl(theme.background)),
    avatarUrl === null ? Promise.resolve(null) : loadCardImage(avatarUrl).catch(() => null),
    loadThemeFonts(theme),
  ]);

  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("canvas 2d indisponible");

  ctx.drawImage(background, 0, 0, CARD_WIDTH, CARD_HEIGHT);
  drawAvatar(ctx, theme, avatar, (data.name[0] ?? "?").toLocaleUpperCase("fr-FR"));
  drawText(ctx, data.name, theme.name.x, theme.name.y, theme.name.style, { maxWidth: theme.name.maxWidth });
  drawText(ctx, data.monthLabel, theme.month.x, theme.month.y, theme.month.style, { maxWidth: theme.month.maxWidth });
  drawText(ctx, data.score, theme.score.x, theme.score.y, theme.score.style, { maxWidth: theme.score.maxWidth });
  drawObjectives(ctx, theme, data);
  drawCounts(ctx, theme, data);
  drawPoints(ctx, theme, data);
}

/** L'image à partager — JPEG qualité 0,9 (~300 Ko), parfait pour une feuille native. */
export function shareCardBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob !== null ? resolve(blob) : reject(new Error("export de la carte impossible"))),
      "image/jpeg",
      0.9,
    );
  });
}
