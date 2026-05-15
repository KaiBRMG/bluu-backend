"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { COMMON_TIMEZONES } from "@/lib/campaignTracking";

export function TimezoneCombobox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = search
    ? COMMON_TIMEZONES.filter(tz => tz.label.toLowerCase().includes(search.toLowerCase()))
    : COMMON_TIMEZONES;
  const selected = COMMON_TIMEZONES.find(tz => tz.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <span className={selected ? "text-white" : "text-zinc-500"}>
            {selected ? selected.label : "Select timezone..."}
          </span>
          <ChevronsUpDown size={14} className="text-zinc-500 shrink-0 ml-2" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search timezones..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup>
              {filtered.map(tz => (
                <CommandItem
                  key={tz.value}
                  value={tz.value}
                  onSelect={() => { onChange(tz.value); setOpen(false); setSearch(""); }}
                >
                  <Check size={14} className={tz.value === value ? "opacity-100" : "opacity-0"} />
                  {tz.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
