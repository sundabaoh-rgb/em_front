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
import { Badge } from "@/components/ui/badge";
import { useUserStore } from "@/store/userStore";

/**
 * AccountMenu
 *
 * Выпадающее меню аккаунта в шапке приложения.
 *
 * Отображает:
 * - аватар с инициалами пользователя
 * - текущую роль (guest / user / admin)
 *
 * Функциональность:
 * - временное переключение ролей (dev / demo режим)
 * - заготовки под настройки и выход
 *
 * Источник данных:
 * - Zustand store (`useUserStore`)
 *
 * Примечание:
 * - переключение ролей используется только для разработки и демо
 * - в продакшене пункты меню будут заменены на реальные auth-действия
 */
export default function AccountMenu() {
  /**
   * Текущее состояние пользователя и экшен смены роли.
   */
  const { user, setRole } = useUserStore();

  /**
   * Инициалы для аватара.
   *
   * Логика:
   * - если есть имя → берём первые 2 символа
   * - если имени нет:
   *   - guest → "G"
   *   - остальные роли → "U"
   */
  const initials =
    user.name?.slice(0, 2).toUpperCase() ??
    (user.role === "guest" ? "G" : "U");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="outline-none">
        <div className="flex items-center gap-2 rounded-full border px-2 py-1 hover:bg-muted cursor-pointer">
          <Avatar className="h-7 w-7">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>

          <Badge variant="outline" className="text-xs">
            {user.role}
          </Badge>
        </div>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>
          {user.role === "guest" ? "Гость" : user.name}
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

        <DropdownMenuItem disabled>
          Настройки (позже)
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          Выход
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
