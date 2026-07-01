FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY lib/factory/reelsBrainRailwayWorker.mjs lib/factory/reelsBrainMediaAssetResolver.mjs ./lib/factory/

CMD ["node", "lib/factory/reelsBrainRailwayWorker.mjs"]
