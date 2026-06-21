import React from "react";
import {Composition} from "remotion";
import {ReelV2, FPS, WIDTH, HEIGHT} from "./ReelV2";
import {ReelV3, DURATION as V3_DURATION} from "./ReelV3";
import {ReelV5, DURATION as V5_DURATION} from "./ReelV5";
import {ReelV7, DURATION as V7_DURATION} from "./ReelV7";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition id="ReelV2" component={ReelV2} durationInFrames={292} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="ReelV3" component={ReelV3} durationInFrames={V3_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="ReelV5" component={ReelV5} durationInFrames={V5_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
      <Composition id="ReelV7" component={ReelV7} durationInFrames={V7_DURATION} fps={FPS} width={WIDTH} height={HEIGHT} />
    </>
  );
};
