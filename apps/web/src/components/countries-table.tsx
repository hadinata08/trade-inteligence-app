"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createColumnHelper, flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type SortingState } from "@tanstack/react-table";
import { formatMn } from "@/lib/utils";

export type CountryRow = {
  code: string;
  name: string;
  iso3: string | null;
  entityType: string;
  exportMn: string | null;
  importMn: string | null;
  balanceMn: string | null;
  completeness: string;
};

const column = createColumnHelper<CountryRow>();

export function CountriesTable({ rows }: { rows: CountryRow[] }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const columns = useMemo(
    () => [
      column.accessor("code", { header: "Kode" }),
      column.accessor("name", {
        header: "Negara",
        cell: (info) => <Link className="font-semibold text-pine underline-offset-2 hover:underline" href={`/countries/${info.row.original.code}`}>{info.getValue()}</Link>,
      }),
      column.accessor("iso3", { header: "ISO3", cell: (info) => info.getValue() ?? "—" }),
      column.accessor("exportMn", { header: "Ekspor", cell: (info) => formatMn(info.getValue()) }),
      column.accessor("importMn", { header: "Impor", cell: (info) => formatMn(info.getValue()) }),
      column.accessor("balanceMn", { header: "Neraca", cell: (info) => formatMn(info.getValue()) }),
      column.accessor("completeness", { header: "Kelengkapan" }),
    ],
    [],
  );
  const table = useReactTable({ data: rows, columns, state: { sorting }, onSortingChange: setSorting, getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel() });
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-line text-left">
              {group.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-semibold">
                  <button type="button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}</button>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="border-b border-line/70">
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2 tabular-nums">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
