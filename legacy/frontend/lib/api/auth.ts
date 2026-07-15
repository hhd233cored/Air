import { apiGet, apiRequest } from "./client";

export type AuthUser = {
  id: string;
  username: string;
  role: "USER" | "ADMIN";
};

type AuthResponse = { user: AuthUser };

export async function getCurrentUser() {
  const response = await apiGet<AuthResponse>("/auth/me");
  return response.user;
}

export async function login(username: string, password: string) {
  const response = await apiRequest<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return response.user;
}

export function logout() {
  return apiRequest<void>("/auth/logout", { method: "POST" });
}
