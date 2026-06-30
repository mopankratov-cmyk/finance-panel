FROM node:24-alpine

WORKDIR /app

COPY lib/factory/reelsBrainRailwayWorker.mjs ./lib/factory/reelsBrainRailwayWorker.mjs

CMD ["node", "lib/factory/reelsBrainRailwayWorker.mjs"]
