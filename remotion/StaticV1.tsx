import React, {useEffect, useState} from "react";
import {AbsoluteFill, Img, useVideoConfig, staticFile, delayRender, continueRender} from "remotion";

// ── STATIC V1 · новая ЛИНИЯ завода: код-рендер статики (БЕЗ fal) по JSON-спеке. «Одно намерение → N экспортов». ──
// Рендерится через renderStill (1 кадр, PNG). Канон/константы — lib/factory/staticCanon.ts; спека — docs/factory-pin-canon.md.
// Формат задаёт холст (calculateMetadata в Root). Архетипы из разведки: headline_hero/product_color/social_proof/collage/card_benefits.
// Текст НИКОГДА на сыром фото → на плашке/scrim (контраст ≥4.5:1). Цена = first-class tabular слот. bottom-right не трогаем (Pinterest Lens).

const PALETTE = {graphiteA: "#0e0f12", graphiteB: "#15171a", ink: "#f2f3f5", inkDark: "#14161a", muted: "rgba(242,243,245,0.6)"};
const SANS = "Montserrat, system-ui, sans-serif";
const DISPLAY = "Unbounded, Montserrat, system-ui, sans-serif";

export type StaticArchetype = "headline_hero" | "product_color" | "social_proof" | "collage" | "card_benefits";
export type StaticV1Props = {
  format: "card_3x4" | "pin_2x3" | "ig_4x5" | "ig_carousel";
  archetype: StaticArchetype;
  productImage?: string;
  productImages?: string[];     // collage
  headline?: string;
  subhead?: string;
  bullets?: string[];           // card_benefits
  price?: string;
  oldPrice?: string;
  badge?: string;               // скидка/«хит»
  brand?: string;
  proof?: string;               // «12 000+ отзывов»
  bg?: string;                  // фон-плашка (иначе accent)
  accent?: string;
  textColor?: string;           // выбран апстримом по контрасту (pickTextColor); дефолт ink
};

export const DEFAULT_PROPS: StaticV1Props = {
  format: "pin_2x3",
  archetype: "headline_hero",
  productImage: "",
  headline: "Сумка, в которую влезает рабочая неделя",
  price: "2 990 ₽",
  oldPrice: "4 490 ₽",
  badge: "-33%",
  brand: "CLÉRIN",
  proof: "12 000+ отзывов",
  accent: "#d9603b",
};

function useFonts() {
  const [handle] = useState(() => delayRender("static-fonts"));
  useEffect(() => {
    const load = (f: string, file: string) => new FontFace(f, `url(${staticFile(file)}) format('truetype')`, {weight: "100 900"}).load();
    Promise.all([load("Montserrat", "fonts/Montserrat.ttf"), load("Unbounded", "fonts/Unbounded.ttf")])
      .then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(handle); })
      .catch(() => continueRender(handle));
  }, [handle]);
}

// плашка цены: tabular figures, Black, старая цена зачёркнута, бейдж-скидка в pill
const PriceBlock: React.FC<{price?: string; oldPrice?: string; badge?: string; accent: string; w: number}> = ({price, oldPrice, badge, accent, w}) => {
  if (!price && !badge) return null;
  const s = w / 1000;
  return (
    <div style={{display: "flex", alignItems: "baseline", gap: 18 * s, fontVariantNumeric: "tabular-nums"}}>
      {price ? <span style={{fontFamily: SANS, fontWeight: 900, fontSize: 96 * s, color: PALETTE.ink, lineHeight: 1}}>{price}</span> : null}
      {oldPrice ? <span style={{fontFamily: SANS, fontWeight: 600, fontSize: 48 * s, color: PALETTE.muted, textDecoration: "line-through"}}>{oldPrice}</span> : null}
      {badge ? <span style={{fontFamily: SANS, fontWeight: 800, fontSize: 40 * s, color: "#0e0f12", background: accent, padding: `${8 * s}px ${20 * s}px`, borderRadius: 999}}>{badge}</span> : null}
    </div>
  );
};

const ProductImg: React.FC<{src?: string; style?: React.CSSProperties}> = ({src, style}) => {
  if (src) return <Img src={src} style={{objectFit: "cover", ...style}} />;
  // плейсхолдер (fal пуст → продукт-картинки Nano ещё нет): нейтральный блок с подсказкой
  return <div style={{display: "flex", alignItems: "center", justifyContent: "center", background: "#23262b", color: PALETTE.muted, fontFamily: SANS, fontSize: 36, ...style}}>фото товара</div>;
};

// F · headline_hero — full-bleed фото + нижний scrim + крупный reverse-out хедлайн + цена. Нативно, не «баннер».
const HeadlineHero: React.FC<StaticV1Props & {w: number; h: number}> = (p) => {
  const {w, h} = p; const s = w / 1000; const accent = p.accent || DEFAULT_PROPS.accent!;
  return (
    <AbsoluteFill>
      <ProductImg src={p.productImage} style={{position: "absolute", inset: 0, width: w, height: h}} />
      <AbsoluteFill style={{background: "linear-gradient(to bottom, rgba(0,0,0,0) 40%, rgba(0,0,0,0.82) 100%)"}} />
      {p.brand ? <span style={{position: "absolute", top: 96 * s, left: 0, right: 0, textAlign: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 40 * s, letterSpacing: 4, color: PALETTE.ink, textShadow: "0 2px 16px rgba(0,0,0,.6)"}}>{p.brand}</span> : null}
      <div style={{position: "absolute", left: 100 * s, right: 100 * s, bottom: 170 * s, display: "flex", flexDirection: "column", gap: 24 * s}}>
        <div style={{width: 90 * s, height: 8 * s, background: accent, borderRadius: 4}} />
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 84 * s, lineHeight: 1.06, color: PALETTE.ink, letterSpacing: -1, textShadow: "0 6px 30px rgba(0,0,0,.6)"}}>{p.headline}</span>
        <PriceBlock price={p.price} oldPrice={p.oldPrice} badge={p.badge} accent={accent} w={w} />
      </div>
    </AbsoluteFill>
  );
};

// B · product_color — cut-out продукт на тёплом solid-фоне (>3× repins), много воздуха, цена + хедлайн снизу.
const ProductColor: React.FC<StaticV1Props & {w: number; h: number}> = (p) => {
  const {w, h} = p; const s = w / 1000; const accent = p.accent || DEFAULT_PROPS.accent!;
  return (
    <AbsoluteFill style={{background: p.bg || accent}}>
      {p.brand ? <span style={{position: "absolute", top: 90 * s, left: 0, right: 0, textAlign: "center", fontFamily: DISPLAY, fontWeight: 800, fontSize: 38 * s, letterSpacing: 4, color: "#0e0f12"}}>{p.brand}</span> : null}
      <ProductImg src={p.productImage} style={{position: "absolute", left: w * 0.12, top: h * 0.18, width: w * 0.76, height: h * 0.5, borderRadius: 28 * s}} />
      <div style={{position: "absolute", left: 100 * s, right: 100 * s, bottom: 150 * s, display: "flex", flexDirection: "column", gap: 22 * s}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 76 * s, lineHeight: 1.05, color: "#0e0f12", letterSpacing: -1}}>{p.headline}</span>
        <PriceBlock price={p.price} oldPrice={p.oldPrice} badge={p.badge} accent="#0e0f12" w={w} />
      </div>
    </AbsoluteFill>
  );
};

// G · social_proof — продукт-герой + ОДНА строка соц-пруфа в углу (не на товаре), высокий контраст.
const SocialProof: React.FC<StaticV1Props & {w: number; h: number}> = (p) => {
  const {w, h} = p; const s = w / 1000; const accent = p.accent || DEFAULT_PROPS.accent!;
  return (
    <AbsoluteFill style={{background: `linear-gradient(160deg, ${PALETTE.graphiteB}, ${PALETTE.graphiteA})`}}>
      <ProductImg src={p.productImage} style={{position: "absolute", inset: 0, width: w, height: h, opacity: 0.92}} />
      <AbsoluteFill style={{background: "linear-gradient(to bottom, rgba(0,0,0,.45) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,.8) 100%)"}} />
      {p.proof ? (
        <div style={{position: "absolute", top: 120 * s, left: 90 * s, background: accent, color: "#0e0f12", fontFamily: SANS, fontWeight: 800, fontSize: 44 * s, padding: `${14 * s}px ${28 * s}px`, borderRadius: 16 * s}}>{p.proof}</div>
      ) : null}
      <div style={{position: "absolute", left: 100 * s, right: 100 * s, bottom: 160 * s, display: "flex", flexDirection: "column", gap: 22 * s}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 80 * s, lineHeight: 1.05, color: PALETTE.ink, letterSpacing: -1, textShadow: "0 6px 30px rgba(0,0,0,.6)"}}>{p.headline}</span>
        <PriceBlock price={p.price} oldPrice={p.oldPrice} badge={p.badge} accent={accent} w={w} />
      </div>
    </AbsoluteFill>
  );
};

// A · collage — 2×2 сетка товаров, объединённая акцент-гаттером, хедлайн-полоса сверху (кураторский «N штук»).
const Collage: React.FC<StaticV1Props & {w: number; h: number}> = (p) => {
  const {w, h} = p; const s = w / 1000; const accent = p.accent || DEFAULT_PROPS.accent!;
  const imgs = (p.productImages && p.productImages.length ? p.productImages : [p.productImage || ""]).slice(0, 4);
  const cells = [0, 1, 2, 3];
  const gut = 12 * s; const headH = 170 * s;
  const cellW = (w - gut * 3) / 2; const cellH = (h - headH - gut * 3) / 2;
  return (
    <AbsoluteFill style={{background: accent}}>
      <div style={{position: "absolute", top: 0, left: 0, right: 0, height: headH, display: "flex", alignItems: "center", justifyContent: "center", padding: `0 ${80 * s}px`}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 62 * s, color: "#0e0f12", textAlign: "center", lineHeight: 1.05}}>{p.headline}</span>
      </div>
      {cells.map((i) => {
        const col = i % 2, row = Math.floor(i / 2);
        return <ProductImg key={i} src={imgs[i % imgs.length]} style={{position: "absolute", left: gut + col * (cellW + gut), top: headH + gut + row * (cellH + gut), width: cellW, height: cellH, borderRadius: 18 * s}} />;
      })}
    </AbsoluteFill>
  );
};

// E · card_benefits — карточка WB/Ozon 3:4: продукт + 3-5 буллетов-выгод (первые 5 слайдов несут всё).
const CardBenefits: React.FC<StaticV1Props & {w: number; h: number}> = (p) => {
  const {w, h} = p; const s = w / 1000; const accent = p.accent || DEFAULT_PROPS.accent!;
  const bullets = (p.bullets || []).slice(0, 5);
  return (
    <AbsoluteFill style={{background: PALETTE.ink}}>
      <ProductImg src={p.productImage} style={{position: "absolute", top: 0, left: 0, width: w, height: h * 0.52}} />
      {p.badge ? <span style={{position: "absolute", top: 40 * s, left: 40 * s, fontFamily: SANS, fontWeight: 800, fontSize: 40 * s, color: "#fff", background: accent, padding: `${10 * s}px ${22 * s}px`, borderRadius: 14 * s}}>{p.badge}</span> : null}
      <div style={{position: "absolute", left: 80 * s, right: 80 * s, top: h * 0.55, display: "flex", flexDirection: "column", gap: 18 * s}}>
        <span style={{fontFamily: DISPLAY, fontWeight: 800, fontSize: 60 * s, lineHeight: 1.05, color: PALETTE.inkDark, letterSpacing: -1}}>{p.headline}</span>
        {bullets.map((b, i) => (
          <div key={i} style={{display: "flex", alignItems: "center", gap: 18 * s}}>
            <div style={{width: 16 * s, height: 16 * s, borderRadius: 4, background: accent, flexShrink: 0}} />
            <span style={{fontFamily: SANS, fontWeight: 600, fontSize: 40 * s, color: PALETTE.inkDark, lineHeight: 1.2}}>{b}</span>
          </div>
        ))}
        <div style={{marginTop: 12 * s}}><PriceBlock price={p.price} oldPrice={p.oldPrice} badge={undefined} accent={accent} w={w} /></div>
      </div>
    </AbsoluteFill>
  );
};

const BODIES: Record<StaticArchetype, React.FC<StaticV1Props & {w: number; h: number}>> = {
  headline_hero: HeadlineHero, product_color: ProductColor, social_proof: SocialProof, collage: Collage, card_benefits: CardBenefits,
};

export const StaticV1: React.FC<StaticV1Props> = (props) => {
  useFonts();
  const {width, height} = useVideoConfig();
  const Body = BODIES[props.archetype] || HeadlineHero;
  return (
    <AbsoluteFill style={{backgroundColor: PALETTE.graphiteA}}>
      <Body {...props} w={width} h={height} />
    </AbsoluteFill>
  );
};
