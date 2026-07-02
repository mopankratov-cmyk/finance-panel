// Contract test for fal-video archive janitor. Run: npx tsx lib/factory/yandexArchiveCleanupContract.test.mts
import { readFileSync } from "node:fs";
import { ok } from "node:assert/strict";
import { isDeletableFalVideoPath } from "./yandexArchive";

const route = readFileSync("app/api/factory/yandex-archive/cleanup/route.ts", "utf8");

// Роут защищён и не удаляет ничего без явного confirm.
ok(/isAuthorizedReelsBrainJobRequest/.test(route), "cleanup route is auth-gated");
ok(/const CONFIRM = "delete-fal-video"/.test(route), "cleanup uses explicit confirm token");
ok(/apply=1&confirm=/.test(route), "GET apply requires confirm");
ok(/body\.confirm !== CONFIRM/.test(route), "POST delete requires confirm");
ok(/isDeletableFalVideoPath/.test(route), "route validates every delete path");

// Guard удаления: только медиа внутри fal-video подпапок архивных корней.
ok(isDeletableFalVideoPath("/content-factory/archive/2026-07-01/bag/fal-video/clr00716-fv.abc-123abc.mp4"), "fal-video mp4 under root is deletable");
ok(isDeletableFalVideoPath("disk:/content-factory/archive/2026-07-01/bag/fal-video/a-1a2b3c.webm"), "disk: prefix is normalized");
ok(isDeletableFalVideoPath("/Приложения/Inferno Archive/2026-07-02/bag/fal-video/clr00716-fv.x-73b7a9.mp4"), "legacy Inferno Archive root is allowed");
ok(!isDeletableFalVideoPath("/content-factory/archive/2026-07-01/unknown-niche/product-twin/clr00716/pt_x/clean.png"), "product twin assets are NOT deletable");
ok(!isDeletableFalVideoPath("/content-factory/archive/2026-07-01/bag/fal-video/notes.txt"), "non-media files are NOT deletable");
ok(!isDeletableFalVideoPath("/some/other/fal-video/x.mp4"), "paths outside archive roots are NOT deletable");
ok(!isDeletableFalVideoPath("/content-factory/archive/2026-07-01/bag/other/x.mp4"), "media outside fal-video subdir is NOT deletable");

console.log("yandexArchiveCleanupContract: passed");
