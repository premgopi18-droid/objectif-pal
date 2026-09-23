"use client";

import { useEffect, useRef, useState } from "react";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { decideEmission } from "./supplement-grace";

/**
 * La caméra qui lit les codes-barres — zxing-wasm (le ZXing C++ compilé en
 * WebAssembly), parce que ni `BarcodeDetector` natif ni le port JS de ZXing
 * ne savent lire le supplément de 5 chiffres — le port JS le tente mais son
 * décodeur d'extensions est cassé (prouvé sur image synthétique parfaite,
 * cf. barcode-decoding.test.ts). Or le supplément d'un fascicule contient le
 * numéro d'issue (specs §5.3).
 *
 * Le supplément reste rarement lisible sur la même frame que le code
 * principal : quand un UPC arrive SANS supplément, on n'émet pas tout de
 * suite — fenêtre de grâce, puis les 12 chiffres partent seuls et la cascade
 * par préfixe prend le relais. Un ISBN (978/979), lui, part au premier
 * décodage : son supplément est le prix, que le routeur jette de toute façon
 * (décision pure et testée dans supplement-grace.ts — fluidité #331).
 */

// Le binaire WASM est servi par NOUS (copié dans public/wasm/ par postinstall,
// cf. scripts/copy-zxing-wasm.mjs), plus par le CDN jsDelivr : un CDN bloqué
// rendait le scanner muet, sans aucun message. Une seule fois au niveau module.
// `fireImmediately` (fluidité #332, item 1) : le fetch + l'instanciation du
// binaire (1 Mo) partent DÈS le chargement de ce module, en parallèle de
// `getUserMedia` — avant, ils n'étaient déclenchés que par le premier
// `readBarcodes`, donc APRÈS la caméra, en série (+0,2 à 2 s avant la première
// frame décodable). Le rejet est avalé ici : le moteur mort se détecte plus
// bas, au premier `readBarcodes` (WASM_FAILURE_THRESHOLD), avec un message.
// NAVIGATEUR SEULEMENT (review #343) : ce module est aussi évalué côté serveur
// (SSR du composant client, build) — sans cette garde, chaque rendu de `/`
// tentait un fetch d'URL relative dans Node (« Failed to parse URL »).
const ZXING_OVERRIDES = {
  locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? "/wasm/zxing_reader.wasm" : prefix + path),
};
prepareZXingModule({ overrides: ZXING_OVERRIDES });
if (typeof window !== "undefined") {
  prepareZXingModule({ overrides: ZXING_OVERRIDES, fireImmediately: true }).catch(() => {});
}

const SUPPLEMENT_GRACE_MILLISECONDS = 1500;
const DECODE_INTERVAL_MILLISECONDS = 180;
/** Autant de rejets de readBarcodes SANS jamais un succès = le module WASM ne se charge pas. */
const WASM_FAILURE_THRESHOLD = 3;

/**
 * Le temps pendant lequel le scanner reste sourd après une lecture, en mode
 * continu (#101 lot C). Il couvre deux choses : le geste de retirer le livre du
 * cadre, et le fait qu'un code-barres encore visible serait relu en boucle.
 */
const REARM_DELAY_MILLISECONDS = 1200;
/** Le même code relu dans cette fenêtre est ignoré : c'est le livre qu'on n'a pas encore rangé. */
const SAME_CODE_MUTE_MILLISECONDS = 4000;

/**
 * La fraction de hauteur réellement décodée (#122) : la bande CENTRALE, celle
 * que le viseur cadre de toute façon. Divise par deux les pixels copiés
 * (getImageData passait 8,3 Mo par frame en 1080p) et décodés, SANS toucher à
 * la résolution horizontale — celle dont les barres minuscules du supplément
 * ont besoin (specs §5.3, la mesure qui a exigé 1080p reste respectée).
 */
const DECODE_BAND_HEIGHT_FRACTION = 0.5;

type BarcodeScannerProps = {
  onCode: (code: string) => void;
  /**
   * Mode rafale (#101 lot C) : le scanner se RÉARME après chaque lecture au
   * lieu de s'arrêter, pour enchaîner une étagère entière sans retoucher
   * l'écran. Sans lui, le comportement historique est inchangé — un scan, une
   * émission, puis plus rien jusqu'à la reprise (`paused` → false) ou au démontage.
   */
  continuous?: boolean;
  /**
   * En veille (fluidité #332, item 7) : le FLUX caméra reste ouvert, seule la
   * boucle de décodage s'arrête. L'écran de scan garde le scanner monté (et
   * caché) pendant la feuille d'actions : revenir au viseur ne rejoue plus
   * `getUserMedia` + autofocus (0,4 à 1,2 s par livre). La reprise réarme le
   * scanner comme un montage neuf.
   */
  paused?: boolean;
};

export function BarcodeScanner({ onCode, continuous = false, paused = false }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [cameraError, setCameraError] = useState(false);
  /** Le moteur WASM n'a pas pu s'initialiser — l'utilisateur doit le SAVOIR, pas fixer une caméra muette. */
  const [engineError, setEngineError] = useState(false);
  /** Le code lu, affiché pendant qu'on espère encore son supplément. */
  const [pendingDisplay, setPendingDisplay] = useState<string | null>(null);

  const hasEmittedRef = useRef(false);
  const pendingRef = useRef<{ code: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  // onCode dans une ref : redémarrer la caméra à chaque render serait bien
  // plus coûteux qu'une callback fraîche.
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  // Dans des refs, comme `onCode` : basculer en rafale ne doit pas redémarrer
  // la caméra (l'utilisateur perdrait la mise au point en plein scan).
  const continuousRef = useRef(continuous);
  useEffect(() => {
    continuousRef.current = continuous;
  }, [continuous]);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEmittedRef = useRef<{ code: string; at: number } | null>(null);

  // La veille (item 7) dans une ref : la boucle la lit à chaque frame sans
  // redémarrer la caméra. La REPRISE réarme tout comme un montage neuf.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
    // Dans les deux sens, aucun timer ne survit : une grâce qui tirerait en
    // veille émettrait un code que personne n'attend.
    if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
    rearmTimerRef.current = null;
    if (pendingRef.current) clearTimeout(pendingRef.current.timer);
    pendingRef.current = null;
    if (paused) return;
    hasEmittedRef.current = false;
    lastEmittedRef.current = null;
    // WebKit met en PAUSE un <video> sorti du rendu (`display: none` pendant
    // la feuille — review #346) : sans ce play(), le viseur revenait figé sur
    // la dernière frame et la boucle décodait la même image. Le flux, lui,
    // est resté ouvert : play() repart sans nouvelle permission.
    videoRef.current?.play().catch(() => {});
    // Le hint du code en grâce meurt avec elle — via un timer, jamais un
    // setState synchrone dans l'effet (règle react-hooks/set-state-in-effect).
    const clearHint = setTimeout(() => setPendingDisplay(null), 0);
    return () => clearTimeout(clearHint);
  }, [paused]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    hasEmittedRef.current = false;

    let stream: MediaStream | undefined;
    let intervalId: ReturnType<typeof setInterval> | undefined;
    let isDecoding = false;
    let isUnmounted = false;
    // Détection d'un moteur mort : readBarcodes qui REJETTE dès les premières
    // frames, sans jamais avoir réussi (une frame sans code-barres, elle,
    // résout normalement avec un tableau vide).
    let hasEverDecoded = false;
    let consecutiveFailures = 0;
    const canvas = document.createElement("canvas");
    // Contexte créé UNE fois (#122) — le redemander par frame était inutile,
    // et surtout réassigner canvas.width/height à chaque frame RÉINITIALISE le
    // canvas (réallocation du backing store 1920×1080, même à valeur
    // identique) : pression GC continue pour rien.
    const context = canvas.getContext("2d", { willReadFrequently: true });

    const emit = (code: string) => {
      if (hasEmittedRef.current || pausedRef.current) return;

      // En rafale, le livre qu'on vient de scanner reste souvent dans le cadre
      // une seconde de trop : sans cette garde, il partirait deux ou trois fois
      // dans la chaîne. Le doublon serait rattrapé plus loin (garde de pile,
      // boîte de finition), mais il polluerait la liste de session.
      const now = performance.now();
      const last = lastEmittedRef.current;
      if (continuousRef.current && last?.code === code && now - last.at < SAME_CODE_MUTE_MILLISECONDS) {
        // Le code muté est CONSOMMÉ (#249) : sans ce nettoyage, un pending dont
        // le timer a déjà tiré restait accroché SANS timer — et tous les scans
        // suivants ne faisaient plus qu'écraser son code, jamais émis : le
        // scanner mourait en silence jusqu'au démontage.
        if (pendingRef.current) clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
        setPendingDisplay(null);
        return;
      }

      hasEmittedRef.current = true;
      lastEmittedRef.current = { code, at: now };
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      // Le hint du code en attente meurt avec lui (#249) : sans ça, il restait
      // affiché jusqu'au prochain code en grâce.
      setPendingDisplay(null);
      onCodeRef.current(code);

      // Le cœur de la rafale : on se réarme au lieu de s'arrêter.
      if (continuousRef.current) {
        rearmTimerRef.current = setTimeout(() => {
          hasEmittedRef.current = false;
        }, REARM_DELAY_MILLISECONDS);
      }
    };

    const decodeFrame = async () => {
      if (pausedRef.current || isDecoding || hasEmittedRef.current || !context) return;
      // Le filet (review #346) : une vidéo mise en pause par le navigateur
      // (arrière-plan, masquage) est relancée plutôt que décodée figée.
      if (video.paused && stream) {
        video.play().catch(() => {});
        return;
      }
      if (video.readyState < video.HAVE_CURRENT_DATA) return;
      isDecoding = true;
      try {
        // La bande centrale seulement (#122) — cf. DECODE_BAND_HEIGHT_FRACTION.
        const bandHeight = Math.max(1, Math.round(video.videoHeight * DECODE_BAND_HEIGHT_FRACTION));
        const bandTop = Math.round((video.videoHeight - bandHeight) / 2);
        // Redimensionné UNIQUEMENT quand la résolution vidéo change réellement
        // (rotation, changement de caméra) — jamais par frame.
        if (canvas.width !== video.videoWidth || canvas.height !== bandHeight) {
          canvas.width = video.videoWidth;
          canvas.height = bandHeight;
        }
        context.drawImage(video, 0, bandTop, video.videoWidth, bandHeight, 0, 0, video.videoWidth, bandHeight);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);

        const results = await readBarcodes(imageData, {
          formats: ["EAN-13", "UPC-A", "EAN-8", "UPC-E"],
          // « Read » : le supplément est lu quand il est là, jamais exigé.
          eanAddOnSymbol: "Read",
          tryHarder: true,
          maxNumberOfSymbols: 1,
        });
        hasEverDecoded = true;
        const result = results[0];
        if (!result?.isValid) return;

        // zxing-cpp renvoie « principal<sep>supplément » : on ne garde que les chiffres.
        const digits = result.text.replace(/\D/g, "");

        // Émettre, ouvrir la grâce, ou suivre : la décision est pure et testée
        // (supplement-grace.ts — règle de rafale #249, raccourci ISBN #331).
        const decision = decideEmission(digits, pendingRef.current?.code ?? null, continuousRef.current);
        if (decision.kind === "emit") {
          emit(decision.code);
        } else if (decision.kind === "wait") {
          setPendingDisplay(digits);
          pendingRef.current = {
            code: digits,
            timer: setTimeout(() => pendingRef.current && emit(pendingRef.current.code), SUPPLEMENT_GRACE_MILLISECONDS),
          };
        } else if (pendingRef.current) {
          pendingRef.current.code = decision.code;
        }
      } catch (error) {
        // Une frame sans code-barres RÉSOUT (tableau vide) : un rejet ici, c'est
        // le module WASM lui-même. Répété dès la première frame = il ne se
        // chargera pas — on le dit au lieu de laisser une caméra muette.
        if (!hasEverDecoded) {
          consecutiveFailures += 1;
          if (consecutiveFailures >= WASM_FAILURE_THRESHOLD) {
            console.error("[scan] le module WASM ne s'initialise pas :", error);
            if (intervalId) clearInterval(intervalId);
            // La caméra ne sert plus à rien : on la libère (LED éteinte).
            stream?.getTracks().forEach((track) => track.stop());
            setEngineError(true);
          }
        }
      } finally {
        isDecoding = false;
      }
    };

    const stopCamera = () => {
      if (intervalId) clearInterval(intervalId);
      intervalId = undefined;
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
    };
    let isStarting = false;
    const startCamera = () => {
      if (stream || isStarting) return;
      isStarting = true;
      navigator.mediaDevices
        .getUserMedia({
          // Résolution élevée exigée : les barres du supplément sont minuscules.
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        .then((mediaStream) => {
          if (isUnmounted || document.hidden) {
            // Démonté ou repassé en arrière-plan pendant la demande : on relâche.
            mediaStream.getTracks().forEach((track) => track.stop());
            return;
          }
          stream = mediaStream;
          video.srcObject = mediaStream;
          return video.play().then(() => {
            intervalId = setInterval(decodeFrame, DECODE_INTERVAL_MILLISECONDS);
          });
        })
        .catch(() => setCameraError(true))
        .finally(() => {
          isStarting = false;
        });
    };
    // L'app en arrière-plan (item 7) : le flux est COUPÉ (LED, batterie) et
    // repart au retour — indispensable maintenant que le scanner reste monté
    // pendant la feuille d'actions.
    const onVisibilityChange = () => {
      if (document.hidden) stopCamera();
      else startCamera();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    startCamera();

    return () => {
      isUnmounted = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopCamera();
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
      // Le timer de réarmement survivrait au démontage et rallumerait un
      // scanner qui n'existe plus.
      if (rearmTimerRef.current) clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    };
  }, []);

  if (cameraError) {
    return (
      <p role="alert" className="rounded-card border border-line bg-card p-4 text-sm text-ink2">
        La caméra est inaccessible (permission refusée ?). Tu peux saisir le code à la main ci-dessous.
      </p>
    );
  }

  if (engineError) {
    return (
      <p role="alert" className="rounded-card border border-line bg-card p-4 text-sm text-ink2">
        Le moteur de scan n&apos;a pas pu se charger — recharge la page ou utilise la saisie manuelle.
      </p>
    );
  }

  return (
    <div className="relative aspect-[3/3.4] overflow-hidden rounded-card border border-line bg-bg0">
      {/*
       * Le viseur (design-specs §5, proto « .viewfinder ») : coins peints au
       * dégradé signature (border-image) et ligne de scan qui balaie — coupée
       * sous prefers-reduced-motion (garde-fou §6). L'animation vit dans un
       * <style> local : globals.css est hors périmètre de ce chantier.
       */}
      <style>{`
        @keyframes scanner-sweep { from { top: 16%; } to { top: 78%; } }
        .scanner-scanline { top: 20%; }
        @media (prefers-reduced-motion: no-preference) {
          .scanner-scanline { animation: scanner-sweep 2.6s ease-in-out infinite alternate; }
        }
      `}</style>
      {/* muted + playsInline : indispensables pour l'autoplay mobile. */}
      <video ref={videoRef} className="absolute inset-0 h-full w-full object-cover opacity-90" muted playsInline />

      {/* Les quatre coins en dégradé (border-image : impossible en utilitaire Tailwind). */}
      <span aria-hidden className="pointer-events-none absolute left-[18px] top-[18px] h-[34px] w-[34px] border-[3px] border-b-0 border-r-0" style={{ borderImage: "var(--grad) 1" }} />
      <span aria-hidden className="pointer-events-none absolute right-[18px] top-[18px] h-[34px] w-[34px] border-[3px] border-b-0 border-l-0" style={{ borderImage: "var(--grad) 1" }} />
      <span aria-hidden className="pointer-events-none absolute bottom-[18px] left-[18px] h-[34px] w-[34px] border-[3px] border-r-0 border-t-0" style={{ borderImage: "var(--grad) 1" }} />
      <span aria-hidden className="pointer-events-none absolute bottom-[18px] right-[18px] h-[34px] w-[34px] border-[3px] border-l-0 border-t-0" style={{ borderImage: "var(--grad) 1" }} />

      {/* La ligne de scan animée. */}
      <span
        aria-hidden
        className="scanner-scanline pointer-events-none absolute inset-x-[26px] h-0.5 rounded-full bg-grad"
        style={{ boxShadow: "0 0 14px color-mix(in srgb, var(--cyan) 80%, transparent)" }}
      />

      {/* Le hint discret : le code en attente de son supplément, sinon le rappel de cadrage. */}
      {pendingDisplay ? (
        <p className="absolute inset-x-0 bottom-3 text-center text-sm font-medium text-ink">
          <span className="rounded-full bg-bg0/70 px-2 py-1">
            <code className="font-mono">{pendingDisplay}</code> — cadre aussi les petits chiffres à droite…
          </span>
        </p>
      ) : (
        <p className="absolute inset-x-0 bottom-3.5 text-center text-[12.5px] text-ink2">
          Vise le code-barres · EAN-13 &amp; suppléments
        </p>
      )}
    </div>
  );
}
