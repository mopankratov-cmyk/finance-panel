import React from "react";
import {Composition} from "remotion";
import {ReelV2, FPS, WIDTH, HEIGHT} from "./ReelV2";
import {ReelV3, DURATION as V3_DURATION} from "./ReelV3";
import {ReelV5, DURATION as V5_DURATION, DEFAULT_PROPS as V5_DEFAULT} from "./ReelV5";
import {ReelV7, DURATION as V7_DURATION} from "./ReelV7";
import {BRoll, DURATION as BROLL_DURATION, DEFAULT_PROPS as BROLL_DEFAULT} from "./BRoll";

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
    </>
  );
};
