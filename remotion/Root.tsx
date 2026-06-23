import React from "react";
import {Composition} from "remotion";
import {ReelV2, FPS, WIDTH, HEIGHT} from "./ReelV2";
import {ReelV3, DURATION as V3_DURATION} from "./ReelV3";
import {ReelV5, DURATION as V5_DURATION, DEFAULT_PROPS as V5_DEFAULT} from "./ReelV5";
import {ReelV7, DURATION as V7_DURATION} from "./ReelV7";
import {BRoll, DURATION as BROLL_DURATION, DEFAULT_PROPS as BROLL_DEFAULT} from "./BRoll";
import {StaticV1, DEFAULT_PROPS as STATIC_DEFAULT} from "./StaticV1";
import {specFor} from "../lib/factory/staticCanon";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="ReelV2" component={ReelV2} durationInFrames={292} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="ReelV3" component={ReelV3} durationInFrames={V3_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="ReelV5" component={ReelV5} durationInFrames={V5_DURATION} fps={FPS} width={WIDTH} height={HEIGHT}
        defaultProps={V5_DEFAULT}
        calculateMetadata={({props}) => ({durationInFrames: props.durationInFrames || V5_DURATION})} />
      <Composition id="ReelV7" component={ReelV7} durationInFrames={V7_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="BRoll" component={BRoll} durationInFrames={BROLL_DURATION} fps={FPS} width={WIDTH} height={HEIGHT}
        defaultProps={BROLL_DEFAULT}
        calculateMetadata={({props}) => ({durationInFrames: props.durationInFrames || BROLL_DURATION})} />
      {/* СТАТИКА: 1 кадр (renderStill→PNG), холст зависит от формата (pin 2:3 / карточка 3:4 / IG 4:5) */}
      <Composition id="StaticV1" component={StaticV1} durationInFrames={1} fps={1} width={1000} height={1500}
        defaultProps={STATIC_DEFAULT}
        calculateMetadata={({props}) => { const s = specFor(props.format); return {width: s.w, height: s.h, durationInFrames: 1, fps: 1}; }} />
    </>
  );
};
