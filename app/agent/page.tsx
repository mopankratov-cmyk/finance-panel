import { AgentPage } from "@/components/agent/AgentPage";
import { BrainCircuit, ExternalLink } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="space-y-5">
      <Link
        href="/agent/reels-brain"
        className="group flex flex-col gap-3 rounded-2xl border border-cyan-200 bg-cyan-50 p-4 text-cyan-950 transition hover:border-cyan-300 hover:bg-cyan-100 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-600 text-white">
            <BrainCircuit className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-black uppercase tracking-[0.18em] text-cyan-700">Reels Brain Lab</span>
            <span className="mt-1 block text-sm text-cyan-800">
              Провайдеры, bake-off, viral corpus и первый слой самообучения для насмотренности.
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-700">
          Открыть пульт
          <ExternalLink className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </span>
      </Link>
      <Link
        href="/inferno/vendor/reels-brain-demo"
        className="group flex flex-col gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-violet-950 transition hover:border-violet-300 hover:bg-violet-100 sm:flex-row sm:items-center sm:justify-between"
      >
        <span className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white">
            <ExternalLink className="h-5 w-5" />
          </span>
          <span>
            <span className="block text-sm font-black uppercase tracking-[0.18em] text-violet-700">Reels Brain Demo</span>
            <span className="mt-1 block text-sm text-violet-800">
              Публичная read-only витрина со всеми модулями от scraper до self-learning loop.
            </span>
          </span>
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-bold text-violet-700">
          Открыть демо
          <ExternalLink className="h-4 w-4 transition group-hover:translate-x-0.5" />
        </span>
      </Link>
      <AgentPage />
    </div>
  );
}
