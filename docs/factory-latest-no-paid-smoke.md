# Factory No-Paid Readiness Smoke

- generated_at: 2026-06-28T13:37:35.771Z
- base_url: https://finance-panel-two.vercel.app
- niche: 
- ready_for_paid_batch: no
- blockers: fal balance low: -1.61 USD | frames-grounded OTK pass-rate is 0 | video memory has no winner examples | source pool is dominated by raw WB assets | 19 recent run_fail recipes | 3 produced videos were judged by text/storyboard/fallback | batch preflight not ready | memory has 0 winner videos
- warnings: series hold: 50-run цель уже закрыта | 50-run цель уже закрыта: перед новым циклом зафиксировать выводы | 12 videos await operator winner/reject feedback | auto-feedback dry-run: winner 0, trash 45

## Quality

- produced_videos: 88
- otk_pass: 0
- pass_rate: 0
- bank_rate: 61.4
- top_warning: OTK below threshold (45)

## Memory

- total: 145
- labels: {"winner":0,"usable":100,"trash":45}
- feedback_queue: 12
- top_feedback_candidate: 16336 · usable · priority 79
- auto_feedback: {"winner":0,"trash":45,"keep":100}
- auto_feedback_note: no objective winner signal found; auto-feedback will not invent winners from weak OTK

## Readiness

- fal: -1.61 USD low=true
- batch_status: 200
- preflight_ready: no
- source_tiers: {"prepared":0,"real":0,"wb":1,"none":0}
- next_action: {"type":"prepare_product","route":"/api/factory/prepare-product","article":"2ndCOS0301","count":1,"reason":"batch has WB-only sources; prepared product frames should lift OTK pass-rate"}

## Next Actions

- prepare_product for WB-only articles before paid batch
- exclude trash memory from pattern selection and review top trash reasons
- fix dominant warning: OTK below threshold
- manually mark at least 3 operator winners or import market metrics before broad learning
