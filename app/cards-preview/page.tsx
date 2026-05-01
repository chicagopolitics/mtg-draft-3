"use client";

import { useEffect, useState } from "react";

import { CardView } from "@/components/Card";
import type { Card } from "@/lib/cards/schema";
import { generatePack } from "@/lib/cards/generator";
import { MOCK_SET } from "@/lib/cards/mock";

export default function CardsPreview() {
  const [pack, setPack] = useState<Card[] | null>(null);
  const [seedCount, setSeedCount] = useState(0);

  useEffect(() => {
    setPack(generatePack(MOCK_SET));
  }, [seedCount]);

  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 p-6 font-sans dark:bg-black">
      <main className="flex w-full max-w-6xl flex-col gap-4">
        <header className="flex items-baseline justify-between border-b border-zinc-200 pb-3 dark:border-zinc-800">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              cards preview
            </h1>
            <p className="text-sm text-zinc-500">
              fresh booster from the mock set ({MOCK_SET.length} cards)
            </p>
          </div>
          <button
            onClick={() => setSeedCount((n) => n + 1)}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            open another pack
          </button>
        </header>

        {pack ? (
          <section className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            {pack.map((card, i) => (
              <CardView key={`${card.id}-${i}`} card={card} />
            ))}
          </section>
        ) : (
          <p className="text-sm text-zinc-500">opening pack…</p>
        )}
      </main>
    </div>
  );
}
