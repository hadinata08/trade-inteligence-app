"use client";

import { useState } from "react";
import { formatMn } from "@/lib/utils";

type Node = { hsCode: string; description: string; exportMn: string | null; importMn: string | null; level?: number };

export function CommodityTree({ partnerCode, periodCode, chapters }: { partnerCode: string; periodCode: string; chapters: Node[] }) {
  if (!chapters.length) return <p className="text-sm text-ink/60">Tidak ada bab HS untuk periode ini.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="px-2 py-2">Kode</th>
            <th>Uraian</th>
            <th>Ekspor</th>
            <th>Impor</th>
          </tr>
        </thead>
        <tbody>
          {chapters.map((chapter) => (
            <TreeRow key={chapter.hsCode} node={{ ...chapter, level: 2 }} partnerCode={partnerCode} periodCode={periodCode} depth={0} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TreeRow({ node, partnerCode, periodCode, depth }: { node: Node; partnerCode: string; periodCode: string; depth: number }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<Node[] | null>(null);
  const [loading, setLoading] = useState(false);
  return (
    <>
      <tr className="border-b border-line/70">
        <td className="px-2 py-2 font-mono" style={{ paddingLeft: 8 + depth * 16 }}>
          <button
            type="button"
            className="mr-2 text-nila"
            onClick={async () => {
              const next = !open;
              setOpen(next);
              if (next && !children) {
                setLoading(true);
                const response = await fetch(`/api/countries/${partnerCode}/children?parent=${node.hsCode}&period=${periodCode}`);
                const body = (await response.json()) as { rows?: Node[] };
                setChildren(body.rows ?? []);
                setLoading(false);
              }
            }}
          >
            {open ? "−" : "+"}
          </button>
          {node.hsCode}
        </td>
        <td>{node.description}</td>
        <td className="tabular-nums">{formatMn(node.exportMn)}</td>
        <td className="tabular-nums">{formatMn(node.importMn)}</td>
      </tr>
      {open && loading ? <tr><td colSpan={4} className="px-8 py-2 text-ink/50">Memuat…</td></tr> : null}
      {open && children?.map((child) => <TreeRow key={child.hsCode} node={child} partnerCode={partnerCode} periodCode={periodCode} depth={depth + 1} />)}
    </>
  );
}
