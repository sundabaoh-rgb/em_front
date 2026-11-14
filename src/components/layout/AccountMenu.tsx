"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useUserStore } from "@/store/userStore";
import { ChevronDown } from "lucide-react";

export default function AccountMenu() {
  const { user, setRole } = useUserStore();

  const initials =
    user.name?.slice(0, 2).toUpperCase() ??
    (user.role === "guest" ? "G" : "U");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        <div className="flex h-9 items-center gap-2 rounded-xl border border-slate-200/80 bg-white pl-1.5 pr-2.5 shadow-2xs transition hover:bg-slate-50 cursor-pointer">
          <Avatar className="h-6 w-6">
            <AvatarFallback className="text-[11px] font-semibold bg-slate-100 text-slate-700">
              {initials}
            </AvatarFallback>
          </Avatar>

          <span className="text-xs font-medium text-foreground capitalize">
            {user.role}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48 rounded-xl">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Режим: {user.role === "guest" ? "Гость" : user.name}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => setRole("guest")}>
          Войти как гость
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setRole("user")}>
          Войти как пользователь
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setRole("admin")}>
          Войти как админ
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem disabled>Настройки (позже)</DropdownMenuItem>
        <DropdownMenuItem disabled>Выход</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}