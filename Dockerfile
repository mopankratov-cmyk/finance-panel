FROM node:24-alpine

WORKDIR /app

COPY lib/factory/reelsBrainRailwayWorker.mjs lib/factory/reelsBrainMediaAssetResolver.mjs ./lib/factory/

CMD ["node", "lib/factory/reelsBrainRailwayWorker.mjs"]
