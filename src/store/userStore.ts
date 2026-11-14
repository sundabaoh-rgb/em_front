"use client";

import { create } from "zustand";
import type { UserInfo, UserRole } from "@/lib/auth";

const USER_LS_KEY = "userRole:v1";

function roleToUser(role: UserRole): UserInfo {
  return {
    role,
    name: role === "guest" ? undefined : role === "admin" ? "Admin" : "User",
  };
}

type UserState = {
  user: UserInfo;
  setRole: (role: UserRole) => void;
};

export const useUserStore = create<UserState>((set) => ({
  user: {
    role: "guest",
  },

  setRole: (role) => {
    try {
      window.localStorage.setItem(USER_LS_KEY, role);
    } catch {}
    set({ user: roleToUser(role) });
  },
}));

if (typeof window !== "undefined") {
  try {
    const saved = window.localStorage.getItem(USER_LS_KEY) as UserRole | null;
    if (saved === "guest" || saved === "user" || saved === "admin") {
      useUserStore.setState({ user: roleToUser(saved) });
    }
  } catch {}
}